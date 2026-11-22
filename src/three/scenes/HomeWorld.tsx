// 首页的 3D 世界：由滚动时间轴驱动的“宣传片”
//
// 镜头、卡牌、筹码、动物全部是“时间轴进度的函数”，所以向上滚动时会完整倒放，不会错位。
// 复用游戏里的牌桌、房间、灯光、座椅、动物模型、卡牌几何与筹码（不重复加载资源）。
// 所有动画都在 R3F 唯一的渲染循环里计算，不触发 React 重新渲染（只有登场动物切换时更新一次）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AnimalModel } from '../animals/AnimalModel';
import type { AnimalConfig } from '../../core/player/profile';
import type { Card } from '../../core/cards/card';
import { AI_HAND, AI_HIDDEN, DEMO_HAND, JOIN_AT, RIVAL, SEAT_SPECIES, getHomeCast } from './homeCast';
import { ClubEnvironment, PokerTableMesh, Chair } from '../environment/ClubEnvironment';
import { SceneLights } from './SceneLights';
import { CardBody } from '../cards/Card3D';
import { ChipStack } from '../chips/Chips';
import { DECK_POS, POT_POS, SEAT_R, SEAT_Y, TABLE_Y, type V3 } from '../layout';
import { useSettings, type Quality } from '../../store/settingsStore';
import { useFx, type AnimName } from '../../store/fxStore';
import { damp } from '../../animation/motion';
import { homeTimeline, range } from '../../ui/home/homeTimeline';

// ───────────── 场景布局 ─────────────

const at = (angle: number, r: number, y: number): V3 => [Math.sin(angle) * r, y, Math.cos(angle) * r];
const SEATS = 6;
const seatAngle = (k: number) => (k / SEATS) * Math.PI * 2;
/** “认识你的对手”舞台位置（牌桌正前方，背景会被压暗） */
const STAGE: V3 = [0, 0, 6.3];
const ANIMAL_FLOOR_Y = 0.42;

const HERO_CARDS: V3[] = [at(-0.12, 2.45, TABLE_Y + 0.012), at(0.12, 2.45, TABLE_Y + 0.014)];
const RIVAL_CARDS: V3[] = [at(Math.PI + 0.11, 2.6, TABLE_Y + 0.012), at(Math.PI - 0.11, 2.6, TABLE_Y + 0.014)];
const BOARD_SLOTS: V3[] = [0, 1, 2, 3, 4].map((i) => [(i - 2) * 0.6, TABLE_Y + 0.012, 0.18]);
const HERO_STACK = at(-0.3, 2.72, TABLE_Y + 0.004);
const RIVAL_STACK = at(Math.PI - 0.34, 2.72, TABLE_Y + 0.004);
const HERO_BET = at(0, 1.95, TABLE_Y + 0.01);
const RIVAL_BET = at(Math.PI, 1.95, TABLE_Y + 0.01);
const potAt = (dx: number, dz = 0): V3 => [POT_POS[0] + dx, POT_POS[1], POT_POS[2] + dz];

// ───────────── 通用：由时间轴驱动的物体 ─────────────

interface Pose {
  pos: V3;
  /** 0 = 背面朝上，1 = 正面朝上（卡牌） */
  face?: number;
  yaw?: number;
  /** 0 = 隐藏 */
  show: number;
  /** 抛物线高度（飞行中） */
  lift?: number;
}

/** 卡牌 / 筹码：每帧根据时间轴计算目标姿态，再平滑插值（滚动很快时也不会跳） */
function Actor({ pose, children, lambda = 14, popScale = true }: { pose: () => Pose; children: ReactNode; lambda?: number; popScale?: boolean }) {
  const ref = useRef<THREE.Group>(null!);
  const st = useRef({ x: 0, y: 0, z: 0, face: 0, yaw: 0, s: 0, init: false });
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const p = pose();
    const s = st.current;
    if (!s.init) {
      Object.assign(s, { x: p.pos[0], y: p.pos[1], z: p.pos[2], face: p.face ?? 0, yaw: p.yaw ?? 0, s: p.show, init: true });
    }
    const k = Math.min(dt, 0.05);
    s.x = damp(s.x, p.pos[0], lambda, k);
    s.y = damp(s.y, p.pos[1] + (p.lift ?? 0), lambda, k);
    s.z = damp(s.z, p.pos[2], lambda, k);
    s.face = damp(s.face, p.face ?? 0, lambda * 0.8, k);
    s.yaw = damp(s.yaw, p.yaw ?? 0, lambda, k);
    s.s = damp(s.s, p.show, lambda * 0.9, k);
    g.visible = s.s > 0.02;
    if (!g.visible) return;
    g.position.set(s.x, s.y, s.z);
    // 翻面：绕卡牌长边转 180°，翻到一半时轻微抬起
    g.rotation.set(0, s.yaw, (1 - s.face) * Math.PI, 'YXZ');
    if (popScale) g.scale.setScalar(Math.max(0.001, s.s));
  });
  return <group ref={ref}>{children}</group>;
}

/** 从 a 飞到 b（t: 0 → 1），带一点弧线 */
function fly(a: V3, b: V3, t: number, arc = 0.28): { pos: V3; lift: number } {
  return { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], lift: Math.sin(t * Math.PI) * arc };
}

const P = homeTimeline.progress;
const inStory = (a: number, b: number) => homeTimeline.story >= a && homeTimeline.story < b;

// ───────────── 卡牌 ─────────────

function BoardCard({ i }: { i: number }) {
  const card = DEMO_HAND.board[i];
  const pose = (): Pose => {
    // 牌桌段落：公共牌从牌堆依次滑到桌面中央（背面朝上）
    const dealt = range(P.table, 0.42 + i * 0.045, 0.52 + i * 0.045);
    const f = fly(DECK_POS, BOARD_SLOTS[i], dealt, 0.18);
    // 牌局段落：翻牌（三张）→ 转牌 → 河牌
    const flipAt = i < 3 ? 0.3 + i * 0.035 : i === 3 ? 0.62 : 0.67;
    const face = range(P.game, flipAt, flipAt + 0.05);
    const show = inStory(1, 4.06) && dealt > 0.001 ? 1 : 0;
    return { pos: f.pos, lift: f.lift + face * (1 - face) * 0.5, face, yaw: (i - 2) * 0.015, show };
  };
  return (
    <Actor pose={pose}>
      <CardBody card={card} />
    </Actor>
  );
}

function SeatCard({ card, to, deal, flip, story, yaw }: { card: Card; to: V3; deal: () => number; flip: () => number; story: [number, number]; yaw: number }) {
  const pose = (): Pose => {
    const d = deal();
    const f = fly(DECK_POS, to, d, 0.32);
    const face = flip();
    return { pos: f.pos, lift: f.lift + face * (1 - face) * 0.45, face, yaw, show: inStory(story[0], story[1]) && d > 0.001 ? 1 : 0 };
  };
  return (
    <Actor pose={pose}>
      <CardBody card={card} />
    </Actor>
  );
}

function DemoCards() {
  return (
    <>
      {DEMO_HAND.board.map((_, i) => (
        <BoardCard key={i} i={i} />
      ))}
      {DEMO_HAND.hero.map((c, i) => (
        <SeatCard key={'h' + i} card={c} to={HERO_CARDS[i]} yaw={i ? -0.08 : 0.08} story={[3, 4.06]} deal={() => range(P.game, 0.05 + i * 0.03, 0.12 + i * 0.03)} flip={() => range(P.game, 0.17, 0.22)} />
      ))}
      {DEMO_HAND.rival.map((c, i) => (
        <SeatCard key={'r' + i} card={c} to={RIVAL_CARDS[i]} yaw={Math.PI + (i ? -0.08 : 0.08)} story={[3, 4.06]} deal={() => range(P.game, 0.065 + i * 0.03, 0.135 + i * 0.03)} flip={() => range(P.game, 0.82, 0.87)} />
      ))}
      {/* AI 段落：你的一对 9 + 对手的两张暗牌 + 翻牌 */}
      {AI_HAND.hero.map((c, i) => (
        <SeatCard key={'ah' + i} card={c} to={HERO_CARDS[i]} yaw={i ? -0.08 : 0.08} story={[5, 6.04]} deal={() => range(P.ai, 0.06 + i * 0.03, 0.13 + i * 0.03)} flip={() => range(P.ai, 0.16, 0.21)} />
      ))}
      {AI_HIDDEN.map((c, i) => (
        <SeatCard key={'ar' + i} card={c} to={RIVAL_CARDS[i]} yaw={Math.PI + (i ? -0.08 : 0.08)} story={[5, 6.04]} deal={() => range(P.ai, 0.075 + i * 0.03, 0.145 + i * 0.03)} flip={() => 0} />
      ))}
      {AI_HAND.board.map((c, i) => (
        <SeatCard key={'ab' + i} card={c} to={BOARD_SLOTS[i]} yaw={(i - 2) * 0.015} story={[5, 6.04]} deal={() => range(P.ai, 0.26 + i * 0.035, 0.33 + i * 0.035)} flip={() => range(P.ai, 0.36 + i * 0.03, 0.41 + i * 0.03)} />
      ))}
    </>
  );
}

// ───────────── 筹码 ─────────────

function ChipActor({ amount, layout = 'bet', pose }: { amount: number; layout?: 'bet' | 'stack'; pose: () => Pose }) {
  return (
    <Actor pose={pose} lambda={12}>
      <ChipStack amount={amount} layout={layout} />
    </Actor>
  );
}

function DemoChips() {
  const stacksIn = () => range(P.table, 0.68, 0.8);
  const stackPose = (pos: V3) => (): Pose => {
    const t = stacksIn();
    return { pos, lift: (1 - t) * 0.7, show: homeTimeline.story >= 1 && t > 0.001 ? 1 : 0 };
  };
  /** 下注：筹码堆 → 下注位置 → 底池 → （获胜）回到赢家 */
  const bet = (from: V3, to: V3, pot: V3, toBet: [number, number], toPot: [number, number], win: [number, number] | null, story: [number, number], p: () => number) => (): Pose => {
    const pr = p();
    const a = range(pr, toBet[0], toBet[1]);
    const b = range(pr, toPot[0], toPot[1]);
    const w = win ? range(pr, win[0], win[1]) : 0;
    let pos: V3;
    let lift = 0;
    if (w > 0) ({ pos, lift } = fly(pot, HERO_STACK, w, 0.3));
    else if (b > 0) ({ pos, lift } = fly(to, pot, b, 0.2));
    else ({ pos, lift } = fly(from, to, a, 0.2));
    return { pos, lift, show: inStory(story[0], story[1]) && a > 0.001 && w < 0.98 ? 1 : 0 };
  };
  const g = () => P.game;
  const ai = () => P.ai;
  return (
    <>
      <ChipActor amount={4800} layout="stack" pose={stackPose(HERO_STACK)} />
      <ChipActor amount={4200} layout="stack" pose={stackPose(RIVAL_STACK)} />
      {/* 其他动物面前的筹码：随动物一起出现 / 离开 */}
      {[1, 2, 4, 5].map((k) => (
        <ChipActor
          key={k}
          amount={2600 + k * 450}
          layout="stack"
          pose={() => {
            const t = stacksIn();
            return { pos: at(seatAngle(k) - 0.34, 2.72, TABLE_Y + 0.004), lift: (1 - t) * 0.7, show: homeTimeline.story >= 1 && t > 0.001 && seatPresent(k) ? 1 : 0 };
          }}
        />
      ))}
      {/* 牌局演示：第一轮加注 / 跟注，河牌全押 / 跟注，摊牌后底池推给赢家 */}
      <ChipActor amount={600} pose={bet(HERO_STACK, HERO_BET, potAt(-0.16), [0.42, 0.47], [0.54, 0.6], [0.92, 0.98], [3, 4.06], g)} />
      <ChipActor amount={600} pose={bet(RIVAL_STACK, RIVAL_BET, potAt(0.16), [0.45, 0.5], [0.55, 0.61], [0.92, 0.98], [3, 4.06], g)} />
      <ChipActor amount={2400} pose={bet(HERO_STACK, HERO_BET, potAt(-0.1, 0.22), [0.72, 0.76], [0.8, 0.84], [0.93, 0.99], [3, 4.06], g)} />
      <ChipActor amount={2400} pose={bet(RIVAL_STACK, RIVAL_BET, potAt(0.12, 0.22), [0.76, 0.8], [0.81, 0.85], [0.93, 0.99], [3, 4.06], g)} />
      {/* AI 段落：你下注，对手思考后跟注 */}
      <ChipActor amount={400} pose={bet(HERO_STACK, HERO_BET, potAt(-0.14), [0.18, 0.24], [0.8, 0.86], null, [5, 6.04], ai)} />
      <ChipActor amount={400} pose={bet(RIVAL_STACK, RIVAL_BET, potAt(0.14), [0.66, 0.72], [0.81, 0.87], null, [5, 6.04], ai)} />
    </>
  );
}

// ───────────── 光晕（自制径向贴图，只创建一次） ─────────────

let glowTex: THREE.Texture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,236,190,1)');
  g.addColorStop(0.45, 'rgba(255,214,140,0.45)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** 地面 / 桌面的柔和光斑：强度由时间轴决定 */
function GlowDisc({ position, size, color = '#ffd28a', level }: { position: V3; size: number; color?: string; level: () => number }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), [color]);
  const ref = useRef<THREE.Mesh>(null!);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((_, dt) => {
    mat.opacity = damp(mat.opacity, level(), 6, Math.min(dt, 0.05));
    if (ref.current) ref.current.visible = mat.opacity > 0.01;
  });
  return (
    <mesh ref={ref} material={mat} position={position} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}

// ───────────── 桌边的动物 ─────────────

/** 某个座位的动物此刻是否在场（按故事位置） */
function seatPresent(k: number): number {
  const s = homeTimeline.story;
  const sinceBorn = (performance.now() - homeTimeline.bornAt) / 1000;
  if (s < 3) return sinceBorn > 0.9 + k * 0.16 || homeTimeline.reduced ? 1 : 0; // 开场：依次入座
  if (s < 4) return k === RIVAL ? 1 : 0; // 牌局演示：只有对手
  if (s < 5) return k === RIVAL || P.online > JOIN_AT[k] ? 1 : 0; // 在线：朋友们一个个加入
  if (s < 6) return k === RIVAL ? 1 : 0; // AI：只有对手
  return 1; // 结尾：全员就座
}

function SeatedAnimal({ k, config }: { k: number; config: AnimalConfig }) {
  const a = seatAngle(k);
  const seat = at(a, SEAT_R, SEAT_Y);
  const key = `home-seat-${k}`;
  const ref = useRef<THREE.Group>(null!);
  const st = useRef({ s: 0, was: 0 });
  useFrame((_, dt) => {
    const want = seatPresent(k);
    const s = st.current;
    // 刚入座：挥手 / 开心（只在出现的瞬间触发一次）
    if (want && !s.was) useFx.getState().play(key, (k % 2 ? 'wave' : 'happy') as AnimName);
    s.was = want;
    s.s = damp(s.s, want, want ? 7 : 10, Math.min(dt, 0.05));
    const g = ref.current;
    if (!g) return;
    g.visible = s.s > 0.02;
    // 轻微“落座”弹性
    const pop = s.s < 1 ? 1 + Math.sin(s.s * Math.PI) * 0.08 : 1;
    g.scale.setScalar(Math.max(0.001, s.s * pop));
  });
  return (
    <group position={seat} rotation={[0, a + Math.PI, 0]}>
      <group ref={ref}>
        <AnimalModel config={config} animKey={key} seated seed={k + 3} />
      </group>
    </group>
  );
}

/** AI 段落：对面的狼在“思考”（转为 AI 思考动作），然后跟注 */
function RivalActing() {
  const st = useRef({ phase: 0 });
  useFrame(() => {
    const s = homeTimeline.story;
    const phase = s >= 5 && s < 6 ? (P.ai < 0.42 ? 1 : P.ai < 0.64 ? 2 : 3) : 0;
    if (phase === st.current.phase) return;
    st.current.phase = phase;
    const fx = useFx.getState();
    const key = `home-seat-${RIVAL}`;
    if (phase === 2) fx.play(key, 'think');
    if (phase === 3) fx.play(key, 'smug');
  });
  return null;
}

// ───────────── “认识你的对手”舞台 ─────────────

function StageAnimal({ configs }: { configs: AnimalConfig[] }) {
  const n = configs.length;
  const [idx, setIdx] = useState(0);
  const ref = useRef<THREE.Group>(null!);
  const st = useRef({ x: -4, yaw: 1.2, s: 0, arrived: -1, idx: 0 });
  useFrame(({ clock }, dt) => {
    const k = Math.min(dt, 0.05);
    const p = P.animals;
    const active = homeTimeline.story > 2.02 && homeTimeline.story < 2.98;
    const seg = Math.min(n - 1, Math.floor(p * n));
    const u = p * n - seg;
    if (seg !== st.current.idx) {
      st.current.idx = seg;
      setIdx(seg); // 只在换角色时更新一次
    }
    // 从左侧走进 → 站定（转身面对镜头）→ 向右离开
    const enter = range(u, 0.08, 0.36);
    const leave = range(u, 0.84, 1);
    const x = -3.6 * (1 - enter) + 3.6 * leave;
    const yaw = 1.15 * (1 - enter) + 1.15 * leave;
    const s = st.current;
    s.x = damp(s.x, x, 10, k);
    s.yaw = damp(s.yaw, yaw, 8, k);
    s.s = damp(s.s, active && enter > 0.01 && leave < 0.99 ? 1 : 0, 10, k);
    if (enter > 0.98 && leave < 0.01 && s.arrived !== seg) {
      s.arrived = seg;
      useFx.getState().play('home-stage', seg % 2 ? 'cool' : 'wave');
    }
    const walking = Math.abs(x - s.x) > 0.02 || (enter > 0 && enter < 1) || (leave > 0 && leave < 1);
    const g = ref.current;
    if (!g) return;
    g.visible = s.s > 0.02;
    g.position.set(STAGE[0] + s.x, ANIMAL_FLOOR_Y + (walking ? Math.abs(Math.sin(clock.elapsedTime * 9)) * 0.05 : 0), STAGE[2]);
    g.rotation.set(0, s.yaw, 0);
    g.scale.setScalar(1.18 * Math.max(0.001, s.s));
  });
  return (
    <group ref={ref}>
      <AnimalModel config={configs[idx]} animKey="home-stage" seed={idx + 11} />
    </group>
  );
}

/** 舞台背景压暗：一块位于动物身后的深色幕布，让俱乐部退到暗处，动物被聚光灯照亮 */
function StageBackdrop() {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#05030a', transparent: true, opacity: 0, depthWrite: false }), []);
  const ref = useRef<THREE.Mesh>(null!);
  const spot = useRef<THREE.SpotLight>(null!);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(STAGE[0], 1, STAGE[2]);
    return o;
  }, []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((_, dt) => {
    const s = homeTimeline.story;
    const want = s > 2.01 && s < 2.99 ? range(s, 2.01, 2.1) * (1 - range(s, 2.9, 2.99)) : 0;
    mat.opacity = damp(mat.opacity, want * 0.86, 5, Math.min(dt, 0.05));
    ref.current.visible = mat.opacity > 0.01;
    if (spot.current) {
      spot.current.intensity = mat.opacity * 70;
      spot.current.visible = mat.opacity > 0.01;
    }
  });
  return (
    <>
      <mesh ref={ref} material={mat} position={[0, 5, STAGE[2] - 1.35]} renderOrder={3}>
        <planeGeometry args={[40, 14]} />
      </mesh>
      <primitive object={target} />
      <spotLight ref={spot} position={[STAGE[0] + 1.2, 6.2, STAGE[2] + 3.5]} target={target} angle={0.42} penumbra={0.85} decay={1.6} distance={16} color="#ffe2b8" intensity={0} />
      <GlowDisc position={[STAGE[0], 0.02, STAGE[2]]} size={3.4} level={() => mat.opacity * 0.5} />
    </>
  );
}

/** “你的座位”：开场时不摆出来（否则会挡住镜头前的牌桌）；结尾时它被拉开一点、斜放着，像在邀请你入座。 */
function YourSeat() {
  const ref = useRef<THREE.Group>(null!);
  const st = useRef({ s: 0 });
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    // 结尾段落开始时，椅子从地面缓缓“升起”，像是为你拉开的座位
    st.current.s = damp(st.current.s, homeTimeline.story > 5.97 ? 1 : 0, 4, Math.min(dt, 0.05));
    g.visible = st.current.s > 0.01;
    g.scale.set(1, Math.max(0.001, st.current.s), 1);
  });
  const p = at(0.08, SEAT_R + 0.45, 0);
  return (
    <group ref={ref} visible={false}>
      <Chair position={p} rotY={Math.PI + 0.45} />
    </group>
  );
}

// ───────────── 镜头 ─────────────

type Key = [number, V3, V3];
/** 镜头关键帧：[故事位置, 镜头位置, 看向] —— 段落 0 开场 · 1 牌桌 · 2 动物 · 3 牌局 · 4 在线 · 5 AI · 6 结尾 */
const KEYS: Key[] = [
  // 开场：牌桌在画面右侧，左侧留给标题；镜头略低，少拍天花板
  [0, [-3.6, 3.3, 11.4], [-2.6, 1.7, 0]],
  [1, [-0.6, 3.4, 8.0], [0, 1.1, 0]],
  [1.5, [0.9, 3.0, 5.4], [0, 1.0, -0.1]],
  [2, [0, 2.45, 3.75], [0, 1.0, -0.35]],
  [2.1, [0, 1.95, 12.4], [0, 1.3, STAGE[2]]],
  [2.9, [0, 1.9, 11.9], [0, 1.3, STAGE[2]]],
  [3.05, [0, 4.9, 5.9], [0, 0.9, 1.15]],
  [3.95, [0, 4.4, 5.2], [0, 0.9, 1.05]],
  [4.08, [0, 8.2, 7.8], [0, 0.9, 0]],
  [4.92, [-1.6, 7.4, 7.2], [0, 1.0, 0]],
  [5.06, [0, 2.75, 5.7], [0, 1.25, -2.0]],
  [5.94, [0, 2.55, 5.2], [0, 1.3, -2.4]],
  // 结尾：镜头从“你的座位”后方缓缓横移，牌桌在画面下半部，上方留给标题
  [6.06, [3.6, 3.5, 10.6], [0, 2.5, -1.2]],
  [7, [-3.2, 3.3, 10.9], [0, 2.45, -1.2]],
];
const INTRO_FROM: V3 = [0, 7.8, 20];

function sampleKeys(s: number, pos: THREE.Vector3, look: THREE.Vector3) {
  let i = 0;
  while (i < KEYS.length - 2 && s > KEYS[i + 1][0]) i++;
  const [s0, p0, l0] = KEYS[i];
  const [s1, p1, l1] = KEYS[i + 1];
  const t = range(s, s0, s1);
  pos.set(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t);
  look.set(l0[0] + (l1[0] - l0[0]) * t, l0[1] + (l1[1] - l0[1]) * t, l0[2] + (l1[2] - l0[2]) * t);
}

function HomeCamera() {
  const { camera, size } = useThree();
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), curLook: new THREE.Vector3(0, 1.2, 0), first: true, shift: 0, w: 0, h: 0 }), []);
  // 离开首页：取消移轴，其他场景的镜头不受影响
  useEffect(() => () => (camera as THREE.PerspectiveCamera).clearViewOffset(), [camera]);
  useFrame((_, dt) => {
    const k = Math.min(dt, 0.05);
    const tl = homeTimeline;
    sampleKeys(tl.story, tmp.pos, tmp.look);
    // 竖屏（手机）：镜头后退一些，保证牌桌完整
    const portrait = size.width / size.height < 0.85;
    if (portrait) {
      // 竖屏：横向构图收回中间，镜头后退；文字在屏幕下半部，所以让场景偏上（看向稍低的位置）
      tmp.pos.x *= 0.35;
      tmp.look.x *= 0.35;
      tmp.pos.sub(tmp.look).multiplyScalar(1.42).add(tmp.look);
      tmp.pos.y += 0.5;
    }
    // 竖屏：镜头“移轴”，整个画面上移（文字在下半部），不改变拍摄角度
    const shift = portrait ? 0.2 : 0;
    if (shift !== tmp.shift || size.width !== tmp.w || size.height !== tmp.h) {
      tmp.shift = shift;
      tmp.w = size.width;
      tmp.h = size.height;
      const cam = camera as THREE.PerspectiveCamera;
      if (shift) cam.setViewOffset(size.width, size.height, 0, size.height * shift, size.width, size.height);
      else cam.clearViewOffset();
    }
    // 鼠标视差：非常轻微（手机 / 减少动态效果时关闭）
    if (!tl.reduced && !tl.compact) {
      tmp.pos.x += tl.pointer.x * 0.32;
      tmp.pos.y -= tl.pointer.y * 0.14;
    }
    const sinceBorn = (performance.now() - tl.bornAt) / 1000;
    if (tmp.first) {
      // 开场：从远处推进到俱乐部（减少动态效果时直接到位）
      if (tl.reduced) camera.position.copy(tmp.pos);
      else camera.position.set(...INTRO_FROM);
      tmp.curLook.copy(tmp.look);
      tmp.first = false;
    }
    const lambda = tl.reduced ? 8 : sinceBorn < 2.6 ? 1.15 : 3.2;
    camera.position.x = damp(camera.position.x, tmp.pos.x, lambda, k);
    camera.position.y = damp(camera.position.y, tmp.pos.y, lambda, k);
    camera.position.z = damp(camera.position.z, tmp.pos.z, lambda, k);
    tmp.curLook.x = damp(tmp.curLook.x, tmp.look.x, lambda * 1.2, k);
    tmp.curLook.y = damp(tmp.curLook.y, tmp.look.y, lambda * 1.2, k);
    tmp.curLook.z = damp(tmp.curLook.z, tmp.look.z, lambda * 1.2, k);
    camera.lookAt(tmp.curLook);
  });
  return null;
}

// ───────────── 场景 ─────────────

const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high', 'ultra'];

export function HomeWorld() {
  const quality = useSettings((s) => s.quality);
  // 手机：环境最高用“中”画质（关闭微粒子与额外点光源）
  const envQuality: Quality = homeTimeline.compact && QUALITY_ORDER.indexOf(quality) > 1 ? 'medium' : quality;
  const { seats: seatConfigs, stage: stageConfigs } = getHomeCast();
  // 离开首页时清掉首页角色的动作 / 说话状态
  useEffect(
    () => () => {
      const fx = useFx.getState();
      for (const k of ['home-stage', ...Object.keys(SEAT_SPECIES).map((x) => `home-seat-${x}`)]) fx.speakEnd(k);
    },
    [],
  );
  return (
    <>
      <SceneLights quality={quality} />
      <ClubEnvironment quality={envQuality} />
      <PokerTableMesh />
      {Array.from({ length: SEATS - 1 }, (_, i) => {
        const a = seatAngle(i + 1);
        return <Chair key={i} position={at(a, SEAT_R, 0)} rotY={a + Math.PI} />;
      })}
      <YourSeat />
      {Object.entries(seatConfigs).map(([k, cfg]) => (
        <SeatedAnimal key={k} k={Number(k)} config={cfg} />
      ))}
      <RivalActing />
      <DemoCards />
      <DemoChips />
      {/* 获胜高亮：你的两张牌下方的金色光晕 */}
      <GlowDisc position={[0, TABLE_Y + 0.006, 2.45]} size={1.6} level={() => (inStory(3, 4) ? range(P.game, 0.88, 0.94) * 0.9 : 0)} />
      {/* 结尾：你的空座位被一束暖光照亮 */}
      <GlowDisc position={at(0.08, SEAT_R + 0.45, 0.03)} size={3.2} level={() => range(homeTimeline.story, 6.15, 6.5)} />
      <StageBackdrop />
      <StageAnimal configs={stageConfigs} />
      <HomeCamera />
    </>
  );
}
