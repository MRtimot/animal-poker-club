import { memo, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { SeatView, TableView } from '../../core/game/view';
import type { Card } from '../../core/cards/card';
import { ACTION_NAME } from '../../core/table/types';
import { AnimalModel } from '../animals/AnimalModel';
import { Card3D } from '../cards/Card3D';
import { ChipPile, ChipFlights } from '../chips/Chips';
import { Chair, ClubEnvironment, PokerTableMesh } from '../environment/ClubEnvironment';
import { CameraRig } from '../camera/CameraRig';
import { Bursts } from '../effects/Bursts';
import { DECK_POS, POT_POS, SeatLayout, TABLE_Y, V3, boardPos, computeLayout } from '../layout';
import { DUR, STAGGER, arc, damp, ease, settle } from '../../animation/motion';
import { AnimatedChips } from '../../ui/common/AnimatedNumber';
import type { Species } from '../../core/player/profile';
import { useFx } from '../../store/fxStore';
import { useGame } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { formatChips } from '../../utils/format';
import { cardBackTexture } from '../textures';
import { SceneLights } from './SceneLights';

interface RetireCard {
  key: string;
  card: Card | null;
  pos: V3;
  yaw: number;
  faceUp: boolean;
}

function seatStatus(p: SeatView, view: TableView): { text: string; cls: string } {
  if (!p.connected && !p.isAI) return { text: '离线', cls: 'offline' };
  if (p.busted) return { text: '已出局', cls: 'out' };
  if (p.sittingOut) return { text: '已离开', cls: 'out' };
  if (view.currentPlayerId === p.id) return { text: '思考中…', cls: 'thinking' };
  if (p.folded) return { text: '弃牌', cls: 'fold' };
  if (p.allIn) return { text: '全押', cls: 'allin' };
  const la = p.lastAction;
  if (la) {
    if (la.type === 'sb') return { text: `小盲 ${formatChips(la.amount)}`, cls: '' };
    if (la.type === 'bb') return { text: `大盲 ${formatChips(la.amount)}`, cls: '' };
    const name = ACTION_NAME[la.type];
    return { text: la.type === 'call' || la.type === 'raise' ? `${name} ${formatChips(la.amount)}` : name, cls: la.type };
  }
  return { text: '', cls: '' };
}

function TurnTimer({ view }: { view: TableView }) {
  const offset = useGame((s) => s.clockOffset);
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(iv);
  }, []);
  if (!view.turnDeadline) return null;
  const remaining = Math.max(0, view.turnDeadline - (Date.now() + offset));
  const total = Math.max(1, view.turnTotalMs);
  const secs = Math.ceil(remaining / 1000);
  const warn = remaining <= 5000 && total > 6000;
  return (
    <div className={`nt-timer ${warn ? 'warn' : ''}`}>
      <div
        key={view.turnDeadline}
        className="nt-timer-bar"
        style={{ animationDuration: `${remaining}ms`, width: `${(remaining / total) * 100}%` }}
      />
      {total > 6000 && <span key={warn ? secs : 'n'} className="nt-secs">{secs}</span>}
    </div>
  );
}

/** 头顶的情绪表情：弹出 → 漂浮 → 淡出 */
function MoodBadge({ playerId }: { playerId: string }) {
  const m = useFx((s) => s.moods[playerId]);
  if (!m) return null;
  return (
    <div key={m.start} className="mood-pop" style={{ animationDuration: `${Math.max(800, m.until - m.start)}ms` }}>
      {m.emoji}
    </div>
  );
}

function Bubble({ playerId }: { playerId: string }) {
  const b = useFx((s) => s.bubbles.find((x) => x.playerId === playerId));
  if (!b) return null;
  return (
    <div key={b.id} className={`bubble ${b.kind === 'emote' ? 'bubble-emote' : ''}`}>
      {b.text}
    </div>
  );
}

const NameTag = memo(function NameTag({ p, view, layout, winAmount }: { p: SeatView; view: TableView; layout: SeatLayout; winAmount: number }) {
  const st = seatStatus(p, view);
  const isCurrent = view.currentPlayerId === p.id;
  const badges: string[] = [];
  if (view.dealerId === p.id) badges.push('庄');
  if (view.sbId === p.id && view.phase !== 'idle') badges.push('小盲');
  if (view.bbId === p.id && view.phase !== 'idle') badges.push('大盲');
  return (
    <Html position={layout.tag} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`nametag ${isCurrent ? 'current' : ''} ${p.folded ? 'folded' : ''} ${layout.isViewer ? 'me' : ''}`}>
        <Bubble playerId={p.id} />
        <MoodBadge playerId={p.id} />
        <div className="nt-name">
          {p.name}
          {layout.isViewer && <span className="nt-you">你</span>}
          {p.isAI && <span className="nt-ai">AI</span>}
        </div>
        <div className="nt-chips">
          🪙 <AnimatedChips value={p.chips} />
        </div>
        {badges.length > 0 && (
          <div className="nt-badges">
            {badges.map((b) => (
              <span key={b} className={`badge badge-${b === '庄' ? 'd' : b === '小盲' ? 'sb' : 'bb'}`}>
                {b}
              </span>
            ))}
          </div>
        )}
        {st.text && <div className={`nt-status ${st.cls}`}>{st.text}</div>}
        {p.shown && !p.folded && <div className="nt-hand">{p.shown.handName}</div>}
        {isCurrent && <TurnTimer view={view} />}
        {winAmount > 0 && <div className="nt-win">+{formatChips(winAmount)}</div>}
      </div>
    </Html>
  );
});

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

const HOP: Partial<Record<Species, boolean>> = { rabbit: true, frog: true, monkey: true };
const HEAVY: Partial<Record<Species, boolean>> = { panda: true, bear: true, koala: true, lion: true };
const ARRIVAL_ANIM: Partial<Record<Species, 'stretch' | 'settle' | 'happy' | 'wave'>> = {
  panda: 'stretch', bear: 'stretch', koala: 'stretch', fox: 'settle', cat: 'settle', rabbit: 'happy', frog: 'happy', monkey: 'wave', dog: 'wave',
};

/**
 * 角色入场：从桌子外侧走（或跳）到座位 → 拉开椅子 → 跳上椅子坐下 → 伸懒腰 / 整理衣服 → 进入待机
 * 熊猫慢慢走、兔子快速蹦过来，重的动物会左右摇摆。
 */
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
  const st = useRef({ start: performance.now() + 500 + order * STAGGER.seatEntrance, done: false, chairOff: 0 });
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
    a.position.set(dirX * dist, y, dirZ * dist);
    a.rotation.z = roll;
    s.chairOff = damp(s.chairOff, chairWant, 9, dt);
    c.position.set(dirX * s.chairOff, 0, dirZ * s.chairOff);
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

function PlayerSeat({ p, view, layout, allLayout, dealOrder, dealDelay, highlight, winAmount, seedIndex }: {
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
  const showdown = view.phase === 'showdown' || view.phase === 'complete';
  // 头转向正在行动的玩家
  const lookYaw = useMemo(() => {
    const cur = view.currentPlayerId && view.currentPlayerId !== p.id ? allLayout.get(view.currentPlayerId) : undefined;
    if (!cur) return null;
    const fx = -Math.sin(layout.angle);
    const fz = -Math.cos(layout.angle);
    const rx = -Math.cos(layout.angle);
    const rz = Math.sin(layout.angle);
    const dx = cur.seat[0] - layout.seat[0];
    const dz = cur.seat[2] - layout.seat[2];
    return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
  }, [view.currentPlayerId, p.id, layout, allLayout]);
  return (
    <group>
      <SeatEntrance
        layout={layout}
        species={p.profile.animal.species}
        playerId={p.id}
        order={seedIndex}
        chair={<Chair position={[layout.seat[0], 0, layout.seat[2]]} rotY={rotY} color={layout.isViewer ? '#1f5c8a' : '#7a1f2b'} />}
      >
        <group position={layout.seat} rotation={[0, rotY, 0]}>
          {!p.busted && !p.sittingOut && (
            <AnimalModel config={p.profile.animal} animKey={p.id} seated folded={p.folded} thinking={thinking} seed={seedIndex} lookYaw={lookYaw} />
          )}
        </group>
      </SeatEntrance>
      <NameTag p={p} view={view} layout={layout} winAmount={winAmount} />

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
            delay={dealDelay + idx * STAGGER.holeCard}
            highlight={!!c && highlight.has(c.id)}
            moveDelay={350}
            revealPause={layout.isViewer ? 160 : 80}
            silent={!layout.isViewer && idx % 2 === 1}
          />
        );
      })}

      {/* 下注筹码 */}
      <ChipPile amount={p.bet} position={layout.bet} />
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
    g.fillText('庄', 64, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useFrame(() => {
    if (!layout || !ref.current) return;
    ref.current.position.lerp(new THREE.Vector3(...layout.button), 0.08);
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

function PotLabel({ view }: { view: TableView }) {
  if (view.potTotal <= 0) return null;
  const side = view.pots.length > 1;
  return (
    <Html position={[POT_POS[0], POT_POS[1] + 0.55, POT_POS[2]]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="pot-label">
        <div>
          底池 <AnimatedChips value={view.potTotal} />
        </div>
        {side && (
          <div className="pot-side">
            {view.pots.map((p, i) => (
              <span key={i}>
                {i === 0 ? '主池' : `边池${i}`} {formatChips(p)}
              </span>
            ))}
          </div>
        )}
      </div>
    </Html>
  );
}

export function GameScene({ view }: { view: TableView }) {
  const quality = useSettings((s) => s.quality);
  const cameraMode = useGame((s) => s.cameraMode);
  const ids = view.players.map((p) => p.id).join(',');
  const layout = useMemo(() => computeLayout(view), [ids, view.viewerId]); // eslint-disable-line

  const dealOrder = useMemo(() => {
    const ev = view.events.find((e) => e.type === 'dealHole');
    return ev && ev.type === 'dealHole' ? ev.order : [];
  }, [view.events]);

  // 获胜高亮的牌
  const { highlight, wins } = useMemo(() => {
    const h = new Set<string>();
    const w = new Map<string, number>();
    if (view.summary && view.phase === 'complete') {
      for (const win of view.summary.winners) {
        w.set(win.playerId, (w.get(win.playerId) ?? 0) + win.amount);
        const shown = view.summary.shown.find((s) => s.playerId === win.playerId);
        shown?.bestCards.forEach((c: Card) => h.add(c.id));
      }
    }
    return { highlight: h, wins: w };
  }, [view.summary, view.phase]);

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
    prev.board.forEach((c, i) => cards.push({ key: 'b' + c.id, card: c, pos: boardPos(i), yaw: 0, faceUp: true }));
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
      <Deck />
      {view.players.map((p, i) => (
        <PlayerSeat
          key={p.id}
          p={p}
          view={view}
          layout={layout.get(p.id)!}
          allLayout={layout}
          dealOrder={dealOrder}
          dealDelay={dealDelay}
          highlight={highlight}
          winAmount={wins.get(p.id) ?? 0}
          seedIndex={i}
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
          arcHeight={i === 4 ? 0.9 : 0.6}
          revealPause={i === 4 ? 520 : i === 3 ? 220 : 90}
          highlight={highlight.has(c.id)}
        />
      ))}
      <ChipPile amount={view.potCollected} position={POT_POS} delay={DUR.chipFlight + 300} neat />
      <PotLabel view={view} />
      <ChipFlights />
      <Bursts density={quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1} />
      <DealerButton layout={view.dealerId ? layout.get(view.dealerId) : undefined} />
      <CameraRig mode={cameraMode} layout={layout} />
    </>
  );
}
