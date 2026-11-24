import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SeatView, TableView } from '../../core/game/view';
import type { Card } from '../../core/cards/card';
import { AnimalModel } from '../animals/AnimalModel';
import { Card3D } from '../cards/Card3D';
import { ChipPile, ChipFlights } from '../chips/Chips';
import { Chair, ClubEnvironment, PokerTableMesh } from '../environment/ClubEnvironment';
import { CameraRig } from '../camera/CameraRig';
import { Bursts } from '../effects/Bursts';
import { BOARD_SCALE, DECK_POS, POT_POS, SeatLayout, TABLE_Y, V3, boardPos, computeLayout } from '../layout';
import { DUR, STAGGER, arc, damp, ease, settle } from '../../animation/motion';
import type { Species } from '../../core/player/profile';
import { useFx } from '../../store/fxStore';
import { useGame } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { cardBackTexture } from '../textures';
import { SceneLights } from './SceneLights';
import { BetTag, PotPlaque, SeatPlate, TableStatus } from './SeatHud';
import { TableMarkings, TurnGlow } from '../environment/TableMarkings';
import { eventShown, presentedBets } from '../../ui/game/hud/model';
import { sound } from '../../audio/sound';
import { chairJolt, useDefeat } from '../../animation/defeat/defeatStore';
import { DefeatFX, DefeatWarmup } from '../effects/DefeatFX';
import { DEFEAT_ISOLATE } from '../effects/DefeatFX';
import { FACE_DROP } from '../camera/defeatCamera';

interface RetireCard {
  key: string;
  card: Card | null;
  pos: V3;
  yaw: number;
  faceUp: boolean;
  scale?: number;
}

/** 底牌的目标位置（发牌、弃牌、回收共用） */
export function holeTarget(p: SeatView, layout: SeatLayout, i: number): { pos: V3; yaw: number; tilt: number } {
  const side = i === 0 ? -1 : 1;
  const tangent: [number, number] = [Math.cos(layout.angle), -Math.sin(layout.angle)];
  const spread = layout.isViewer ? 0.3 : 0.2;
  const pos: V3 = p.folded
    ? [layout.muck[0] + side * 0.08, layout.muck[1] + i * 0.009, layout.muck[2]]
    : [
        layout.cards[0] + tangent[0] * side * spread,
        layout.cards[1] + (layout.isViewer ? 0.18 : 0) + i * 0.004,
        layout.cards[2] + tangent[1] * side * spread,
      ];
  return { pos, yaw: layout.angle + (p.folded ? 0.6 + i * 0.4 : side * 0.06), tilt: layout.isViewer && !p.folded ? 0.55 : 0 };
}

/** 从某个座位看向另一个座位需要转头的角度（相对于正对牌桌中心） */
function yawToward(from: SeatLayout, to: SeatLayout): number {
  const fx = -Math.sin(from.angle);
  const fz = -Math.cos(from.angle);
  const rx = -Math.cos(from.angle);
  const rz = Math.sin(from.angle);
  const dx = to.seat[0] - from.seat[0];
  const dz = to.seat[2] - from.seat[2];
  return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
}

const HOP: Partial<Record<Species, boolean>> = { rabbit: true, frog: true, monkey: true };
const HEAVY: Partial<Record<Species, boolean>> = { panda: true, bear: true, koala: true, lion: true };
const ARRIVAL_ANIM: Partial<Record<Species, 'stretch' | 'settle' | 'happy' | 'wave'>> = {
  panda: 'stretch', bear: 'stretch', koala: 'stretch', fox: 'settle', cat: 'settle', rabbit: 'happy', frog: 'happy', monkey: 'wave', dog: 'wave',
};

/**
 * 角色入场：从桌子外侧走（或跳）到座位 → 拉开椅子 → 跳上椅子坐下 → 伸懒腰 / 整理衣服 → 进入待机
 * 熊猫慢慢走、兔子快速蹦过来，重的动物会左右摇摆。
 */
const jAxis = new THREE.Vector3();
const jQuat = new THREE.Quaternion();
const jPivot = new THREE.Vector3();
const jOff = new THREE.Vector3();
const jTmp = new THREE.Vector3();

function SeatEntrance({ layout, species, playerId, order, chair, children }: {
  layout: SeatLayout;
  species: Species;
  playerId: string;
  order: number;
  chair: ReactNode;
  children: ReactNode;
}) {
  const animal = useRef<THREE.Group>(null!);
  const chairRef = useRef<THREE.Group>(null!);
  const st = useRef({ start: performance.now() + 500 + order * STAGGER.seatEntrance, done: false, chairOff: 0, jPush: 0, jTilt: 0 });
  const hop = !!HOP[species];
  const heavy = !!HEAVY[species];
  const walkMs = hop ? 850 : heavy ? 1750 : 1200;
  const dirX = Math.sin(layout.angle);
  const dirZ = Math.cos(layout.angle);
  useFrame((_, dt) => {
    const s = st.current;
    const a = animal.current;
    const c = chairRef.current;
    if (!a || !c) return;
    const now = performance.now();
    const t = now - s.start;
    const total = walkMs + 420;
    let dist = 0;
    let y = 0;
    let roll = 0;
    let chairWant = 0;
    if (t < 0) {
      a.visible = false;
      chairWant = 0;
    } else if (t < walkMs) {
      a.visible = true;
      const p = t / walkMs;
      dist = 3.2 * (1 - ease.inOutSine(p));
      const steps = hop ? 3 : heavy ? 5 : 6;
      const ph = p * steps * Math.PI;
      y = -0.3 + (hop ? Math.abs(Math.sin(ph)) * 0.38 : Math.abs(Math.sin(ph)) * 0.06);
      roll = heavy ? Math.sin(ph) * 0.09 : Math.sin(ph) * 0.03;
      chairWant = p > 0.45 ? 0.5 : 0; // 快到时拉开椅子
    } else if (t < total) {
      a.visible = true;
      // 跳上椅子
      const p = (t - walkMs) / 420;
      y = -0.3 + 0.3 * ease.outCubic(p) + arc(p, 0.32);
      chairWant = 0.5 * (1 - ease.inOutCubic(p));
    } else {
      a.visible = true;
      y = settle((t - total) / 1000, 0.05, 20, 9);
      if (!s.done) {
        s.done = true;
        const anim = ARRIVAL_ANIM[species] ?? 'settle';
        useFx.getState().play(playerId, anim);
      }
    }
    // 失败演出：输家的椅子被冲击撞得往后滑、向后翘起再落回地面，动物跟着失去平衡（只是画面）
    const dj = chairJolt(playerId, now, heavy);
    const active = dj.push > 0 || dj.tilt > 0;
    s.jPush = active ? dj.push : damp(s.jPush, 0, 5, dt);
    s.jTilt = active ? dj.tilt : damp(s.jTilt, 0, 8, dt);
    s.chairOff = damp(s.chairOff, chairWant, 9, dt);
    a.position.set(dirX * dist, y, dirZ * dist);
    a.rotation.set(0, 0, roll);
    c.position.set(dirX * s.chairOff, 0, dirZ * s.chairOff);
    c.quaternion.identity();
    if (s.jPush > 0.0005 || s.jTilt > 0.0005) {
      // 以椅子后腿着地的位置为支点向后翘
      jAxis.set(dirZ, 0, -dirX);
      jQuat.setFromAxisAngle(jAxis, s.jTilt);
      jPivot.set(layout.seat[0] + dirX * 0.45, 0, layout.seat[2] + dirZ * 0.45);
      jOff.copy(jPivot).applyQuaternion(jQuat).negate().add(jPivot);
      c.quaternion.copy(jQuat);
      c.position.add(jOff).add(jTmp.set(dirX * s.jPush, 0, dirZ * s.jPush));
      a.quaternion.premultiply(jQuat);
      a.position.add(jOff).add(jTmp.set(dirX * s.jPush * 0.85, 0, dirZ * s.jPush * 0.85));
    }
  });
  return (
    <>
      <group ref={chairRef}>{chair}</group>
      <group ref={animal} visible={false}>
        {children}
      </group>
    </>
  );
}

function PlayerSeat({ p, view, layout, allLayout, dealOrder, showdownOrder, dealDelay, highlight, winAmount, seedIndex, betShown, revealHand }: {
  showdownOrder: string[];
  /** 已经落地的下注额（与筹码动画同步） */
  betShown: number;
  /** 摊牌已开始演出 */
  revealHand: boolean;
  p: SeatView;
  view: TableView;
  layout: SeatLayout;
  allLayout: Map<string, SeatLayout>;
  dealDelay: number;
  dealOrder: string[];
  highlight: Set<string>;
  winAmount: number;
  seedIndex: number;
}) {
  const rotY = layout.angle + Math.PI;
  const thinking = view.currentPlayerId === p.id;
  // 失败演出：其他动物一个接一个转头看向输家；输家看向赢家。出局的输家在演出结束前继续显示
  const dseq = useDefeat((s) => s.seq);
  const defeatLook = useMemo(() => {
    if (!dseq) return null;
    const targetId = p.id === dseq.loserId ? dseq.winnerId : dseq.loserId;
    const from = p.id === dseq.loserId ? dseq.at.realize : dseq.lookers[p.id];
    const t = targetId ? allLayout.get(targetId) : undefined;
    if (!t || from === undefined) return null;
    return { yaw: yawToward(layout, t), from };
  }, [dseq, p.id, layout, allLayout]);
  const keepVisible = !!dseq && dseq.loserId === p.id;
  const showdown = view.phase === 'showdown' || view.phase === 'complete';
  // 摊牌时按顺序逐个亮牌
  const showOrder = Math.max(0, showdownOrder.indexOf(p.id));
  // 头转向正在行动的玩家
  const lookYaw = useMemo(() => {
    const cur = view.currentPlayerId && view.currentPlayerId !== p.id ? allLayout.get(view.currentPlayerId) : undefined;
    if (!cur) return null;
    return yawToward(layout, cur);
  }, [view.currentPlayerId, p.id, layout, allLayout]);
  return (
    <group>
      <SeatEntrance
        layout={layout}
        species={p.profile.animal.species}
        playerId={p.id}
        order={seedIndex}
        chair={<Chair position={[layout.seat[0], 0, layout.seat[2]]} rotY={rotY} />}
      >
        <group position={layout.seat} rotation={[0, rotY, 0]}>
          {(!p.busted || keepVisible) && !p.sittingOut && (
            <AnimalModel config={p.profile.animal} animKey={p.id} seated folded={p.folded} thinking={thinking} seed={seedIndex} lookYaw={lookYaw} defeatLook={defeatLook} />
          )}
        </group>
      </SeatEntrance>
      <SeatPlate p={p} view={view} layout={layout} winAmount={winAmount} revealHand={revealHand} revealDelay={showOrder * 650 + 550} />
      <BetTag amount={betShown} position={layout.bet} />

      {/* 底牌 */}
      {p.hole.map((c, i) => {
        const { pos, yaw, tilt } = holeTarget(p, layout, i);
        // 发牌顺序：第 i 轮中该玩家的位置
        let idx = 0;
        let seen = 0;
        for (let k = 0; k < dealOrder.length; k++) {
          if (dealOrder[k] === p.id) {
            if (seen === i) {
              idx = k;
              break;
            }
            seen++;
          }
        }
        const faceUp = !!c && !p.folded && (layout.isViewer || showdown);
        return (
          <Card3D
            key={`${view.handNumber}-${p.id}-${i}`}
            card={c}
            target={pos}
            yaw={yaw}
            tilt={tilt}
            faceUp={faceUp}
            flipDelay={layout.isViewer ? 0 : showOrder * 650}
            delay={dealDelay + idx * STAGGER.holeCard}
            highlight={!!c && highlight.has(c.id)}
            moveDelay={350}
            revealPause={layout.isViewer ? 160 : 80}
            silent={!layout.isViewer && idx % 2 === 1}
          />
        );
      })}

      {/* 下注筹码 */}
      {/* 玩家面前的筹码堆（赢得的筹码到达后才增加） */}
      <ChipPile amount={p.chips} position={layout.stack} layout="stack" delay={1650} rotY={layout.angle} />
      {/* 下注筹码 */}
      <ChipPile amount={p.bet} position={layout.bet} layout="bet" />
    </group>
  );
}

function DealerButton({ layout }: { layout?: SeatLayout }) {
  const ref = useRef<THREE.Group>(null!);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fffdf5';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c9a227';
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = '#1d1d2b';
    g.font = 'bold 64px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 76px Georgia, "Times New Roman", serif';
    g.fillText('D', 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  // 离开牌桌时释放显存（每进入一次牌桌都会创建一张新贴图）
  useEffect(() => () => tex.dispose(), [tex]);
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!layout || !ref.current) return;
    ref.current.position.lerp(target.set(...layout.button), 0.08);
  });
  if (!layout) return null;
  return (
    <group ref={ref} position={layout.button}>
      <mesh castShadow position={[0, 0.025, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.05, 32]} />
        <meshStandardMaterial attach="material-0" color="#fffdf5" roughness={0.4} />
        <meshStandardMaterial attach="material-1" map={tex} roughness={0.4} />
        <meshStandardMaterial attach="material-2" color="#fffdf5" />
      </mesh>
    </group>
  );
}

function Deck() {
  const back = useMemo(() => cardBackTexture(), []);
  return (
    <group position={[DECK_POS[0], TABLE_Y, DECK_POS[2]]} rotation={[0, 0.2, 0]}>
      <mesh castShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[0.5, 0.1, 0.7]} />
        <meshStandardMaterial attach="material-0" color="#efe8d8" />
        <meshStandardMaterial attach="material-1" color="#efe8d8" />
        <meshStandardMaterial attach="material-2" map={back} />
        <meshStandardMaterial attach="material-3" color="#efe8d8" />
        <meshStandardMaterial attach="material-4" color="#efe8d8" />
        <meshStandardMaterial attach="material-5" color="#efe8d8" />
      </mesh>
    </group>
  );
}

/** 胜利时照亮赢家区域的聚光灯（自然、克制地亮起再退去） */
function WinnerLight({ layout }: { layout: Map<string, SeatLayout> }) {
  const light = useRef<THREE.SpotLight>(null!);
  const target = useMemo(() => new THREE.Object3D(), []);
  const level = useRef(0);
  const warm = useMemo(() => new THREE.Color('#ffe2b0'), []);
  const cool = useMemo(() => new THREE.Color('#dfe6ff'), []);
  const coolK = useRef(0);
  useFrame((_, dt) => {
    // 失败演出：这盏聚光灯改为从输家头顶打下的冷色光，把输家从变暗的房间里孤立出来；
    // 演出期间一直保持“可见”（只改亮度），避免显示 / 隐藏灯光造成所有材质重新编译而卡顿
    const d = useDefeat.getState();
    const loser = d.seq && d.phase && d.phase !== 'recover' ? layout.get(d.seq.loserId) : undefined;
    coolK.current = damp(coolK.current, loser ? 1 : 0, 3, dt);
    if (loser) {
      const want = (DEFEAT_ISOLATE[d.phase!] ?? 0.05) * (d.seq!.cut === 'short' ? 0.6 : 1);
      level.current = damp(level.current, want, 2.4, dt);
      target.position.set(loser.head[0], loser.head[1] - FACE_DROP - 0.2, loser.head[2]);
      light.current.position.set(loser.seat[0] * 0.92, 6.6, loser.seat[2] * 0.92);
      light.current.color.lerpColors(warm, cool, coolK.current);
      light.current.intensity = level.current * 60;
      light.current.visible = true;
      return;
    }
    const cue = useFx.getState().cue;
    const seat = cue && cue.type === 'win' && cue.playerId ? layout.get(cue.playerId) : undefined;
    const t = cue ? (performance.now() - cue.start) / cue.duration : 1;
    const want = seat && t < 0.92 ? 1 : 0;
    level.current = damp(level.current, want, want ? 2.2 : 1.4, dt);
    if (seat) {
      target.position.set(seat.seat[0], 1.6, seat.seat[2]);
      light.current.position.set(seat.seat[0] * 0.35, 7.2, seat.seat[2] * 0.35);
    }
    light.current.color.lerpColors(warm, cool, coolK.current);
    light.current.intensity = level.current * 70;
    light.current.visible = level.current > 0.01;
  });
  return (
    <>
      <primitive object={target} />
      <spotLight ref={light} target={target} angle={0.32} penumbra={0.8} decay={2} color="#ffe2b0" intensity={0} visible={false} />
    </>
  );
}

export function GameScene({ view }: { view: TableView }) {
  const quality = useSettings((s) => s.quality);
  const cameraMode = useGame((s) => s.cameraMode);
  const ids = view.players.map((p) => p.id).join(',');
  const layout = useMemo(() => computeLayout(view), [ids, view.viewerId]); // eslint-disable-line

  const showdownOrder = useMemo(() => {
    const ev = view.events.find((e) => e.type === 'showdown');
    return ev && ev.type === 'showdown' ? ev.hands.map((h) => h.playerId) : [];
  }, [view.events]);
  // 大底池：底池占全桌筹码的比例 → 灯光与音乐的紧张度
  useEffect(() => {
    const total = view.players.reduce((a, p) => a + p.chips + p.bet, 0) + view.potCollected;
    const ratio = total > 0 ? view.potTotal / total : 0;
    const tension = Math.min(1, Math.max(0, (ratio - 0.15) / 0.45));
    useFx.getState().setTension(tension);
    sound.setBaseIntensity(tension * 0.6);
  }, [view.potTotal]); // eslint-disable-line

  const dealOrder = useMemo(() => {
    const ev = view.events.find((e) => e.type === 'dealHole');
    return ev && ev.type === 'dealHole' ? ev.order : [];
  }, [view.events]);

  // 演出进度：底池 / 下注金额随筹码落地更新；摊牌牌型在亮牌时出现；赢家与获胜牌在赢家演出开始时才高亮
  const shown = useFx((s) => s.shown);
  const presentedHand = useFx((s) => s.presentation?.hand);
  const winShown = presentedHand === view.handNumber;
  const showdownShown = eventShown(view, shown, 'showdown');
  const bets = useMemo(() => presentedBets(view, shown), [view, shown]);

  // 获胜高亮的牌
  const { highlight, wins } = useMemo(() => {
    const h = new Set<string>();
    const w = new Map<string, number>();
    if (view.summary && view.phase === 'complete' && winShown) {
      for (const win of view.summary.winners) {
        w.set(win.playerId, (w.get(win.playerId) ?? 0) + win.amount);
        const shown = view.summary.shown.find((s) => s.playerId === win.playerId);
        shown?.bestCards.forEach((c: Card) => h.add(c.id));
      }
    }
    return { highlight: h, wins: w };
  }, [view.summary, view.phase, winShown]);

  useEffect(() => () => useFx.getState().reset(), []);

  // 上一手的牌：新一手开始时依次滑回牌堆（桌面清理动画），新牌稍后再发
  const prevView = useRef<TableView | null>(null);
  const [retiring, setRetiring] = useState<{ hand: number; cards: RetireCard[] }>({ hand: -1, cards: [] });
  useEffect(() => {
    const prev = prevView.current;
    prevView.current = view;
    if (!prev || prev.handNumber === view.handNumber) return;
    const pl = computeLayout(prev);
    const cards: RetireCard[] = [];
    prev.board.forEach((c, i) => cards.push({ key: 'b' + c.id, card: c, pos: boardPos(i), yaw: 0, faceUp: true, scale: BOARD_SCALE }));
    for (const p of prev.players) {
      const l = pl.get(p.id);
      if (!l) continue;
      p.hole.forEach((c, i) => {
        const t = holeTarget(p, l, i);
        cards.push({ key: p.id + i, card: c, pos: t.pos, yaw: t.yaw, faceUp: !!c && !p.folded && (l.isViewer || prev.phase === 'complete' || prev.phase === 'showdown') });
      });
    }
    setRetiring({ hand: view.handNumber, cards });
    const tm = setTimeout(() => setRetiring((r) => (r.hand === view.handNumber ? { hand: r.hand, cards: [] } : r)), 1400);
    return () => clearTimeout(tm);
  }, [view.handNumber]); // eslint-disable-line
  const dealDelay = retiring.hand === view.handNumber && retiring.cards.length ? 260 + retiring.cards.length * STAGGER.retireCard : 0;

  return (
    <>
      <SceneLights quality={quality} />
      <ClubEnvironment quality={quality} />
      <PokerTableMesh />
      <TableMarkings />
      <TurnGlow layout={view.currentPlayerId ? layout.get(view.currentPlayerId) : undefined} mine={view.currentPlayerId === view.viewerId} />
      <Deck />
      {view.players.map((p, i) => (
        <PlayerSeat
          key={p.id}
          p={p}
          view={view}
          layout={layout.get(p.id)!}
          allLayout={layout}
          dealOrder={dealOrder}
          showdownOrder={showdownOrder}
          dealDelay={dealDelay}
          highlight={highlight}
          winAmount={wins.get(p.id) ?? 0}
          seedIndex={i}
          betShown={bets.get(p.id) ?? 0}
          revealHand={showdownShown}
        />
      ))}
      {retiring.cards.map((rc, i) => (
        <Card3D
          key={`r${retiring.hand}-${rc.key}`}
          card={rc.card}
          from={rc.pos}
          fromYaw={rc.yaw}
          fromFaceUp={rc.faceUp}
          target={DECK_POS}
          yaw={0.2}
          faceUp={false}
          delay={i * STAGGER.retireCard}
          flightMs={DUR.cardRetire}
          arcHeight={0.3}
          vanishOnLand
          silent={i % 3 !== 0}
          scale={rc.scale}
        />
      ))}
      {view.board.map((c, i) => (
        <Card3D
          key={`${view.handNumber}-b-${c.id}`}
          card={c}
          target={boardPos(i)}
          faceUp
          // 翻牌三张依次出现，中间短暂停顿；河牌飞得更慢、停顿更久再翻开
          delay={i < 3 ? STAGGER.flop[i] : 120}
          flightMs={i === 4 ? 720 : 560}
          arcHeight={i === 4 ? 0.32 : 0.18}
          revealPause={i === 4 ? 520 : i === 3 ? 220 : 90}
          highlight={highlight.has(c.id)}
          scale={BOARD_SCALE}
        />
      ))}
      <ChipPile amount={view.potCollected} position={POT_POS} delay={DUR.chipFlight + 300} layout="neat" />
      <WinnerLight layout={layout} />
      <PotPlaque view={view} />
      <TableStatus view={view} />
      <ChipFlights />
      <Bursts density={quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1} />
      <DealerButton layout={view.dealerId ? layout.get(view.dealerId) : undefined} />
      {/* 失败演出的灯光、烟雾与粒子（只在演出期间挂载） */}
      <DefeatFX layout={layout} />
      <DefeatWarmup />
      <CameraRig mode={cameraMode} layout={layout} />
    </>
  );
}
