// 21 点 3D 牌桌：复用俱乐部房间、牌桌、灯光、镜头、卡牌、筹码、动物与粒子；只有桌面标线、牌靴和座位布局不同。
// 牌、下注、结果全部来自视图（服务器 / 本地控制器）；这里只负责画面。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DEALER_ID, type BjSeatView, type BlackjackView } from '../../core/blackjack/types';
import type { BjCard } from '../../core/blackjack/shoe';
import { useBjCine } from '../../animation/blackjack/cineStore';
import { DUR, STAGGER } from '../../animation/motion';
import { useFx } from '../../store/fxStore';
import { useGame } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { sound } from '../../audio/sound';
import { AnimalModel } from '../animals/AnimalModel';
import { CameraRig } from '../camera/CameraRig';
import { Card3D } from '../cards/Card3D';
import { ChipFlights, ChipPile } from '../chips/Chips';
import { Bursts } from '../effects/Bursts';
import { Chair, ClubEnvironment, PokerTableMesh } from '../environment/ClubEnvironment';
import { TurnGlow } from '../environment/TableMarkings';
import { SEAT_R, type SeatLayout, type V3 } from '../layout';
import { SceneLights } from '../scenes/SceneLights';
import { SeatEntrance, yawToward } from '../scenes/SeatEntrance';
import { BlackjackMarkings, ShoeAndDiscard } from './Markings';
import { BjSeatPlate, BubbleAnchor } from './SeatPlates';
import { DISCARD_POS, SHOE_POS, TRAY_POS, computeBlackjackLayout, dealDelay, dealerCardTarget, handBetPos, handCardTarget, layoutSeats } from './layout';

/** 庄家筹码盘里的筹码（装饰，不参与任何计算） */
const TRAY_CHIPS = 36575;

function Seat({ p, view, layout, all, index, paid }: { p: BjSeatView; view: BlackjackView; layout: SeatLayout; all: Map<string, SeatLayout>; index: number; paid: boolean }) {
  const rotY = layout.angle + Math.PI;
  const thinking = view.currentPlayerId === p.id;
  // 看向正在行动的人；庄家行动时看庄家
  const target = view.currentPlayerId && view.currentPlayerId !== p.id ? view.currentPlayerId : view.phase === 'dealer-turn' || view.phase === 'round-end' ? DEALER_ID : null;
  const lookYaw = useMemo(() => {
    const t = target ? all.get(target) : undefined;
    return t ? yawToward(layout, t) : null;
  }, [target, layout, all]);
  const staked = p.hands.reduce((s, h) => s + h.bet, 0);
  return (
    <group>
      <SeatEntrance layout={layout} species={p.profile.animal.species} playerId={p.id} order={index} chair={<Chair position={[layout.seat[0], 0, layout.seat[2]]} rotY={rotY} />}>
        <group position={layout.seat} rotation={[0, rotY, 0]}>
          {!p.left && <AnimalModel config={p.profile.animal} animKey={p.id} seated thinking={thinking} seed={index} lookYaw={lookYaw} />}
        </group>
      </SeatEntrance>
      {p.id === view.viewerId ? <BubbleAnchor id={p.id} layout={layout} /> : <BjSeatPlate p={p} view={view} layout={layout} paid={paid} />}
      {/* 放在同一个数组里（key = 实体牌编号）：分牌时牌从一手滑到另一手，不会重新发一次 */}
      {p.hands.flatMap((h, hi) =>
        h.cards.map((c, i) => {
          const t = handCardTarget(layout, hi, p.hands.length, i, h.cards.length, h.doubled);
          return (
            <Card3D
              key={c.uid + view.roundId}
              card={c}
              from={SHOE_POS}
              target={t.pos}
              yaw={t.yaw}
              scale={t.scale}
              faceUp
              delay={dealDelay(view, p.id, i)}
              highlight={paid && (h.result === 'win' || h.result === 'blackjack')}
              flatShadow
            />
          );
        }),
      )}
      {/* 手里的筹码：派彩的筹码到了才增加 */}
      <ChipPile amount={view.phase === 'round-end' && !paid ? Math.max(0, p.balance - p.hands.reduce((s, h) => s + h.payout, 0)) : p.balance} position={layout.stack} layout="stack" delay={DUR.chipFlight + 300} rotY={layout.angle} />
      {/* 下注圈里的筹码 */}
      {p.hands.length
        ? p.hands.map((h, hi) => <ChipPile key={h.id} amount={paid ? 0 : h.bet} position={handBetPos(layout, hi, p.hands.length)} layout="bet" delay={staked > 0 ? DUR.chipFlight : 0} />)
        : <ChipPile amount={p.bet} position={handBetPos(layout, 0, 1)} layout="bet" />}
    </group>
  );
}

interface Retired {
  key: string;
  card: BjCard;
  pos: V3;
  yaw: number;
  scale: number;
}

export function BlackjackScene({ view }: { view: BlackjackView }) {
  const quality = useSettings((s) => s.quality);
  const cameraMode = useGame((s) => s.cameraMode);
  const paidRound = useBjCine((s) => s.paidRound);
  const paid = paidRound === view.roundId;
  // 座位没有变化就沿用同一份布局（视图每次更新都是新对象）
  const ids = view.players.map((p) => p.id).join('\n');
  const layout = useMemo(() => layoutSeats(ids.split('\n'), view.viewerId), [ids, view.viewerId]);
  const dealerSeat = layout.get(DEALER_ID)!;

  // 离开牌桌：清掉动画、气泡、粒子与镜头提示
  useEffect(
    () => () => {
      useFx.getState().reset();
      sound.setBaseIntensity(0);
    },
    [],
  );

  // 上一局的牌：新一局开始时依次滑进弃牌盒
  const prevView = useRef<BlackjackView | null>(null);
  const [retired, setRetired] = useState<{ round: string; cards: Retired[] }>({ round: '', cards: [] });
  useLayoutEffect(() => {
    const prev = prevView.current;
    if (!prev || prev.roundId === view.roundId) return;
    const pl = computeBlackjackLayout(prev);
    const cards: Retired[] = [];
    prev.dealer.cards.forEach((c, i) => {
      if (!c) return;
      const t = dealerCardTarget(i, prev.dealer.cards.length);
      cards.push({ key: c.uid, card: c, pos: t.pos, yaw: 0, scale: t.scale });
    });
    for (const p of prev.players) {
      const l = pl.get(p.id);
      if (!l) continue;
      p.hands.forEach((h, hi) =>
        h.cards.forEach((c, i) => {
          const t = handCardTarget(l, hi, p.hands.length, i, h.cards.length, h.doubled);
          cards.push({ key: c.uid, card: c, pos: t.pos, yaw: t.yaw, scale: t.scale });
        }),
      );
    }
    setRetired({ round: view.roundId, cards });
  }, [view]);
  useEffect(() => {
    if (!retired.cards.length) return;
    const tm = setTimeout(() => setRetired({ round: retired.round, cards: [] }), 700 + retired.cards.length * STAGGER.retireCard);
    return () => clearTimeout(tm);
  }, [retired]);
  useEffect(() => {
    prevView.current = view;
  }, [view]);

  const n = view.dealer.cards.length;
  const current = view.currentPlayerId ? layout.get(view.currentPlayerId) : undefined;
  const used = view.shoe.size ? 1 - view.shoe.remaining / view.shoe.size : 0;

  return (
    <>
      <SceneLights quality={quality} />
      <ClubEnvironment quality={quality} />
      <PokerTableMesh />
      <BlackjackMarkings rules={view.rules} layout={layout} seats={view.players.map((p) => p.id)} />
      <ShoeAndDiscard used={used} />
      <TurnGlow layout={current} mine={view.currentPlayerId === view.viewerId} />
      <ChipPile amount={TRAY_CHIPS} position={TRAY_POS} layout="neat" />

      {/* 庄家：站在桌子对面 */}
      <group position={[0, 0.1, -(SEAT_R - 0.2)]} scale={1.16}>
        <AnimalModel config={view.dealer.profile.animal} animKey={DEALER_ID} seed={17} thinking={view.phase === 'dealer-turn' && !view.dealer.revealed} lookYaw={0} />
      </group>
      <BubbleAnchor id={DEALER_ID} layout={dealerSeat} dy={0.35} />

      {view.players.map((p, i) => (
        <Seat key={p.id} p={p} view={view} layout={layout.get(p.id)!} all={layout} index={i} paid={paid} />
      ))}

      {/* 庄家的牌：暗牌没有点数（card = null），翻开时同一张牌原地翻面 */}
      {view.dealer.cards.map((c, i) => {
        const t = dealerCardTarget(i, n);
        return <Card3D key={`${view.roundId}-d${i}`} card={c} from={SHOE_POS} target={t.pos} scale={t.scale} faceUp={!!c} delay={dealDelay(view, DEALER_ID, i)} revealPause={i >= 2 ? 180 : 80} highlight={paid && view.dealer.blackjack} flatShadow />;
      })}

      {retired.cards.map((rc, i) => (
        <Card3D key={`r${retired.round}-${rc.key}`} card={rc.card} from={rc.pos} fromYaw={rc.yaw} fromFaceUp target={DISCARD_POS} yaw={0.5} faceUp={false} delay={i * STAGGER.retireCard} flightMs={DUR.cardRetire} arcHeight={0.3} vanishOnLand silent={i % 3 !== 0} scale={rc.scale} flatShadow />
      ))}

      <ChipFlights />
      <Bursts density={quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1} />
      <CameraRig mode={cameraMode} layout={layout} preset="blackjack" />
    </>
  );
}
