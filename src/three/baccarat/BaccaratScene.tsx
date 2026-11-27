// 百家乐 3D 牌桌：复用俱乐部房间、牌桌、灯光、镜头、卡牌、筹码、动物与粒子；只有桌面印记、牌的位置、座位下注圈不同。
// 牌、下注、结果全部来自视图（服务器 / 本地控制器）；这里只负责画面。外观（牌桌 / 牌 / 筹码）是纯视觉。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BAC_DEALER_ID, type BacSeatView, type BacSide, type BaccaratView } from '../../core/baccarat/types';
import type { BacCard } from '../../core/baccarat/shoe';
import { betTotal } from '../../core/baccarat/rules';
import { useBacCine } from '../../animation/baccarat/cineStore';
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
import { TABLE_Y, type SeatLayout, type V3 } from '../layout';
import { SceneLights } from '../scenes/SceneLights';
import { SeatEntrance, yawToward } from '../scenes/SeatEntrance';
import { DefeatIsolationLight, useDefeatLook } from '../scenes/defeatStage';
import { DefeatFX, DefeatWarmup } from '../effects/DefeatFX';
import { ShoeAndDiscard } from '../blackjack/Markings';
import { BubbleAnchor } from '../blackjack/SeatPlates';
import { CARD_SKINS, CardSkinContext, ChipSkinContext, TABLE_THEMES } from '../skins';
import { BaccaratMarkings } from './Markings';
import { BacSeatPlate } from './SeatPlates';
import { DEALER_SCALE, DEALER_STAND, DISCARD_POS, SHOE_POS, TRAY_POS, bacCardTarget, bacSpotPos, layoutBacSeats } from './layout';

const TRAY_CHIPS = 48250;

function Seat({ p, view, layout, all, index, paid }: { p: BacSeatView; view: BaccaratView; layout: SeatLayout; all: Map<string, SeatLayout>; index: number; paid: boolean }) {
  const rotY = layout.angle + Math.PI;
  // 失败演出：其他动物转头看向输家；输家看向庄家（赢家）
  const defeatLook = useDefeatLook(p.id, layout, all);
  // 开牌时所有人都看向牌
  const lookYaw = useMemo(() => {
    const t = all.get(BAC_DEALER_ID);
    return t ? yawToward(layout, t) : null;
  }, [layout, all]);
  const settled = view.phase === 'round-end' && !!p.returns;
  const balance = settled && !paid ? p.balance - betTotal(p.returns!) : p.balance;
  return (
    <group>
      <SeatEntrance layout={layout} species={p.profile.animal.species} playerId={p.id} order={index} chair={<Chair position={[layout.seat[0], 0, layout.seat[2]]} rotY={rotY} />}>
        <group position={layout.seat} rotation={[0, rotY, 0]}>
          {!p.left && <AnimalModel config={p.profile.animal} animKey={p.id} seated thinking={view.phase === 'betting' && !p.placed && !p.skipped} seed={index} lookYaw={view.phase === 'dealing' ? lookYaw : null} defeatLook={defeatLook} />}
        </group>
      </SeatEntrance>
      {p.id === view.viewerId ? <BubbleAnchor id={p.id} layout={layout} /> : <BacSeatPlate p={p} view={view} layout={layout} paid={paid} />}
      <ChipPile amount={balance} position={layout.stack} layout="stack" delay={DUR.chipFlight + 300} rotY={layout.angle} />
      {(['player', 'tie', 'banker'] as const).map((s) => (
        <ChipPile key={s} amount={paid ? 0 : p.bets[s]} position={bacSpotPos(layout, s)} layout="bet" delay={p.bets[s] > 0 ? DUR.chipFlight : 0} />
      ))}
    </group>
  );
}

interface Retired {
  key: string;
  card: BacCard;
  pos: V3;
  yaw: number;
  scale: number;
}

export function BaccaratScene({ view }: { view: BaccaratView }) {
  const quality = useSettings((s) => s.quality);
  const themeId = useSettings((s) => s.bacTable);
  const cardSkin = useSettings((s) => s.bacCards);
  const chipSkin = useSettings((s) => s.bacChips);
  const theme = TABLE_THEMES[themeId];
  const cameraMode = useGame((s) => s.cameraMode);
  const paid = useBacCine((s) => s.paidRound === view.roundId);
  const ids = view.players.map((p) => p.id).join('\n');
  const layout = useMemo(() => layoutBacSeats(ids.split('\n'), view.viewerId), [ids, view.viewerId]);
  const dealerSeat = layout.get(BAC_DEALER_ID)!;
  const dealerLook = useDefeatLook(BAC_DEALER_ID, dealerSeat, layout);

  useEffect(
    () => () => {
      useFx.getState().reset();
      sound.setBaseIntensity(0);
    },
    [],
  );

  // 上一局的牌：新一局开始时依次滑进弃牌盒
  const prevView = useRef<BaccaratView | null>(null);
  const [retired, setRetired] = useState<{ round: string; cards: Retired[] }>({ round: '', cards: [] });
  useLayoutEffect(() => {
    const prev = prevView.current;
    if (!prev || prev.roundId === view.roundId) return;
    const cards: Retired[] = [];
    for (const side of ['player', 'banker'] as BacSide[])
      prev.hands[side].cards.forEach((c, i) => {
        const t = bacCardTarget(side, i);
        cards.push({ key: c.uid, card: c, pos: t.pos, yaw: t.yaw, scale: t.scale });
      });
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

  // 停止下注后：先把四张牌背朝上发到牌框里；之后每公开一张，就是同一张牌原地翻面
  const facedown = view.phase === 'closed' || view.phase === 'dealing' || view.phase === 'result' || view.phase === 'payout' || view.phase === 'round-end';
  const slots: { side: BacSide; index: number; card: BacCard | null }[] = [];
  if (facedown) {
    for (const side of ['player', 'banker'] as BacSide[]) {
      const cards = view.hands[side].cards;
      for (let i = 0; i < Math.max(2, cards.length); i++) slots.push({ side, index: i, card: cards[i] ?? null });
    }
  }
  const used = view.shoe.size ? 1 - view.shoe.remaining / view.shoe.size : 0;

  return (
    <CardSkinContext.Provider value={cardSkin}>
      <ChipSkinContext.Provider value={chipSkin}>
        <SceneLights quality={quality} />
        <ClubEnvironment quality={quality} />
        <PokerTableMesh felt={theme.felt} rail={theme.rail} />
        {/* 主题的补光：只是颜色与氛围 */}
        <pointLight position={[0, TABLE_Y + 2.6, -0.4]} intensity={quality === 'low' ? 0.5 : 0.9} distance={7} decay={2} color={theme.light} />
        <BaccaratMarkings rules={view.rules} layout={layout} seats={view.players.map((p) => p.id)} accent={theme.accent} />
        <ShoeAndDiscard used={used} />
        <ChipPile amount={TRAY_CHIPS} position={TRAY_POS} layout="neat" />

        <group position={DEALER_STAND} scale={DEALER_SCALE}>
          <AnimalModel config={view.dealer.profile.animal} animKey={BAC_DEALER_ID} seed={23} thinking={view.phase === 'dealing'} lookYaw={0} defeatLook={dealerLook} />
        </group>
        <BubbleAnchor id={BAC_DEALER_ID} layout={dealerSeat} dy={0.35} />

        {view.players.map((p, i) => (
          <Seat key={p.id} p={p} view={view} layout={layout.get(p.id)!} all={layout} index={i} paid={paid} />
        ))}

        {slots.map((s, i) => {
          const t = bacCardTarget(s.side, s.index);
          // 前四张：停止下注时依次发出（闲、庄、闲、庄）；第三张：公开时才发出
          const order = s.index < 2 ? s.index * 2 + (s.side === 'banker' ? 1 : 0) : 0;
          return (
            <Card3D
              key={`${view.roundId}-${s.side}${s.index}`}
              card={s.card}
              from={SHOE_POS}
              target={t.pos}
              yaw={t.yaw}
              scale={t.scale}
              faceUp={!!s.card}
              delay={view.phase === 'closed' && s.index < 2 ? order * 230 : 0}
              revealPause={s.index === 2 ? 260 : 120}
              highlight={paid && !!view.result && (view.result.winner === s.side || view.result.winner === 'tie')}
              flatShadow
              silent={i > 5}
            />
          );
        })}

        {retired.cards.map((rc, i) => (
          <Card3D key={`r${retired.round}-${rc.key}`} card={rc.card} from={rc.pos} fromYaw={rc.yaw} fromFaceUp target={DISCARD_POS} yaw={0.5} faceUp={false} delay={i * STAGGER.retireCard} flightMs={DUR.cardRetire} arcHeight={0.3} vanishOnLand silent={i % 3 !== 0} scale={rc.scale} flatShadow />
        ))}

        <ChipFlights />
        <Bursts density={quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1} />
        {/* 失败演出（与德州共用）：输家头顶的冷光、冲击的烟雾与粒子、处决时的头部 */}
      <DefeatIsolationLight layout={layout} />
      <DefeatFX layout={layout} />
      <DefeatWarmup />
      <CameraRig mode={cameraMode} layout={layout} preset="baccarat" />
        {/* 牌背外观改变时，牌靴里露出的那张也一起变（只是外观） */}
        <group userData={{ cardSkin: CARD_SKINS[cardSkin].name }} />
      </ChipSkinContext.Provider>
    </CardSkinContext.Provider>
  );
}
