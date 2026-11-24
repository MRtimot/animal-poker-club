import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { chipSideTexture, chipTopTexture } from '../textures';
import { useFx } from '../../store/fxStore';
import { sound } from '../../audio/sound';
import { DUR, STAGGER, clamp01, ease, settle } from '../../animation/motion';
import { shadowGeo, shadowMaterial } from '../realism';
import { TABLE_Y } from '../layout';
import { tableJolt } from '../../animation/defeat/defeatStore';

/** 赌场筹码配色（低饱和、接近真实粘土筹码） */
export const DENOMS: { value: number; color: string; label: string }[] = [
  { value: 100000, color: '#1f6a73', label: '100K' },
  { value: 25000, color: '#8e3558', label: '25K' },
  { value: 5000, color: '#b3561f', label: '5000' },
  { value: 1000, color: '#c49a32', label: '1000' },
  { value: 500, color: '#4e2f78', label: '500' },
  { value: 100, color: '#1b1b20', label: '100' },
  { value: 25, color: '#1e6a44', label: '25' },
  { value: 5, color: '#a3222c', label: '5' },
  { value: 1, color: '#f4f1ea', label: '1' },
];

export const CHIP_R = 0.105;
export const CHIP_H = 0.026;
const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 36);
const matCache = new Map<number, THREE.Material[]>();

function chipMats(value: number) {
  let m = matCache.get(value);
  if (!m) {
    const d = DENOMS.find((x) => x.value === value)!;
    // 粘土筹码：略带光泽的清漆，非金属
    const side = new THREE.MeshPhysicalMaterial({ map: chipSideTexture(d.color), roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.45 });
    const top = new THREE.MeshPhysicalMaterial({ map: chipTopTexture(d.color, d.label), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 });
    m = [side, top, top];
    matCache.set(value, m);
  }
  return m;
}

/**
 * 金额拆分为筹码：先按大面额，再把大面额“换零”成小面额，
 * 让筹码堆的高度和数量更像真实牌桌（10 枚 = 小堆，20 枚 = 高堆）
 */
export function breakdown(amount: number, maxPer = 20, minChips = 8): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  let rest = Math.round(amount);
  for (const d of DENOMS) {
    const c = Math.floor(rest / d.value);
    if (c > 0) {
      counts.set(d.value, c);
      rest -= c * d.value;
    }
  }
  const total = () => [...counts.values()].reduce((a, b) => a + Math.min(b, maxPer), 0);
  for (let guard = 0; guard < 30 && total() < minChips; guard++) {
    let changed = false;
    for (let i = 0; i < DENOMS.length - 1; i++) {
      const big = DENOMS[i].value;
      const cnt = counts.get(big) ?? 0;
      if (!cnt) continue;
      const small = DENOMS.slice(i + 1).find((d) => big % d.value === 0 && big / d.value <= 10);
      if (!small) continue;
      const k = big / small.value;
      if ((counts.get(small.value) ?? 0) + k > maxPer) continue;
      counts.set(big, cnt - 1);
      counts.set(small.value, (counts.get(small.value) ?? 0) + k);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return DENOMS.filter((d) => (counts.get(d.value) ?? 0) > 0).map((d) => ({ value: d.value, count: Math.min(counts.get(d.value)!, maxPer) }));
}

export type StackLayout = 'neat' | 'stack' | 'bet';

/** 筹码列的位置：底池整齐成排，玩家筹码紧凑排列，下注筹码略分散 */
function columnOffset(i: number, n: number, layout: StackLayout): [number, number] {
  const gap = CHIP_R * 2.12;
  if (layout === 'neat' || layout === 'stack') {
    const perRow = layout === 'stack' ? Math.min(4, n) : Math.min(5, n);
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i % perRow;
    const rows = Math.ceil(n / perRow);
    return [(col - (inRow - 1) / 2) * gap + (row % 2) * gap * 0.25, (row - (rows - 1) / 2) * gap * 0.95];
  }
  const ring: [number, number][] = [[0, 0], [gap, 0.02], [-gap * 0.5, gap * 0.86], [gap * 0.5, -gap * 0.86], [-gap, -0.02], [gap * 0.55, gap * 0.86], [-gap * 0.5, -gap * 0.86]];
  return ring[i % ring.length];
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

/** 一列筹码：实例化渲染（一次绘制调用），每枚筹码有微小的错位和旋转 */
function ChipColumn({ value, count, seed }: { value: number; count: number; seed: number }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const mats = chipMats(value);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    for (let i = 0; i < count; i++) {
      const jx = Math.sin(i * 2.3 + seed * 1.7) * 0.0045;
      const jz = Math.cos(i * 1.7 + seed * 2.1) * 0.0045;
      tmpP.set(jx, CHIP_H / 2 + i * CHIP_H * 1.002, jz);
      tmpE.set(Math.sin(i * 3.1 + seed) * 0.012, i * 0.9 + seed, Math.cos(i * 2.7 + seed) * 0.012);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP, tmpQ, ONE);
      m.setMatrixAt(i, tmpM);
    }
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [count, seed]);
  return <instancedMesh ref={ref} args={[chipGeo, mats, Math.max(1, count)]} castShadow receiveShadow />;
}

/** 接触阴影：筹码与桌面接触处的柔和暗部，消除“漂浮感” */
function ColumnShadow({ opacity = 0.6 }: { opacity?: number }) {
  return <mesh geometry={shadowGeo} material={shadowMaterial('circle', opacity)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, 0]} scale={CHIP_R * 2.9} renderOrder={1} />;
}

export const ChipStack = memo(function ChipStack({ amount, seed = 0, layout = 'bet', maxPer = 20 }: { amount: number; seed?: number; layout?: StackLayout; maxPer?: number }) {
  const cols = useMemo(() => breakdown(amount, maxPer, layout === 'stack' ? 12 : layout === 'neat' ? 10 : 4), [amount, maxPer, layout]);
  return (
    <group>
      {cols.map((c, ci) => {
        const [ox, oz] = columnOffset(ci, cols.length, layout);
        return (
          <group key={c.value} position={[ox, 0, oz]}>
            <ColumnShadow />
            <ChipColumn value={c.value} count={c.count} seed={seed + ci} />
          </group>
        );
      })}
    </group>
  );
});

/**
 * 金额显示的延迟：增加时等筹码移动到位再显示（delayUp），减少时立即生效（筹码已经被推走）
 */
export function useDelayedValue(value: number, delayUp: number, delayDown = 0): number {
  const [v, setV] = useState(value);
  useEffect(() => {
    const d = value > v ? delayUp : delayDown;
    if (d <= 0) {
      setV(value);
      return;
    }
    const t = setTimeout(() => setV(value), d);
    return () => clearTimeout(t);
  }, [value, delayUp, delayDown]); // eslint-disable-line
  return v;
}

/** 静态筹码堆：新筹码到达时整堆轻微压缩再稳定（克制的重量感） */
export function ChipPile({ amount, position, delay = DUR.chipFlight + 120, layout = 'bet', rotY = 0 }: { amount: number; position: [number, number, number]; delay?: number; layout?: StackLayout; rotY?: number }) {
  const shown = useDelayedValue(amount, delay);
  const ref = useRef<THREE.Group>(null!);
  const pop = useRef(-10);
  const prev = useRef(shown);
  useEffect(() => {
    if (shown > prev.current) pop.current = performance.now();
    prev.current = shown;
  }, [shown]);
  useFrame(() => {
    if (!ref.current) return;
    const now = performance.now();
    const t = (now - pop.current) / 1000;
    const k = t < 0.5 ? settle(t, 0.04, 26, 10) : 0;
    ref.current.scale.set(1, 1 + k, 1);
    // 失败演出的冲击：筹码堆震动、滑开一点再滑回（只是画面，筹码数量不变）
    const j = tableJolt(position[0], position[2], now, position[0] * 5.3 + position[2] * 2.1);
    ref.current.position.set(position[0] + j.dx, position[1] + j.lift * 0.35, position[2] + j.dz);
    ref.current.rotation.set(j.rx * 0.25, rotY, j.rz * 0.25);
  });
  if (shown <= 0) return null;
  return (
    <group ref={ref} position={position} rotation={[0, rotY, 0]}>
      <ChipStack amount={shown} seed={Math.round(position[0] * 7 + position[2] * 3)} layout={layout} maxPer={layout === 'bet' ? 12 : 20} />
    </group>
  );
}

/**
 * 筹码移动：每列筹码依次被拿起，贴着桌面滑出（加速 → 匀速 → 摩擦减速），
 * 到达后落下并与已有筹码接触，最后稳定。派奖时抬得稍高一些。
 */
function FlyingChips({ id }: { id: number }) {
  const flight = useFx((s) => s.flights.find((f) => f.id === id));
  const cols = useMemo(() => (flight ? breakdown(flight.amount, 8, 3) : []), [flight?.amount]); // eslint-disable-line
  const refs = useRef<(THREE.Group | null)[]>([]);
  const shadows = useRef<(THREE.Mesh | null)[]>([]);
  const shadowMats = useMemo(() => cols.map(() => shadowMaterial('circle', 0.5).clone()), [cols]);
  useEffect(() => () => shadowMats.forEach((m) => m.dispose()), [shadowMats]);
  const played = useRef(false);
  const offs = useMemo(() => cols.map((_, i) => columnOffset(i, cols.length, 'bet')), [cols]);
  useFrame(() => {
    if (!flight) return;
    const now = performance.now();
    const [fx, fy, fz] = flight.from;
    const [tx, ty, tz] = flight.to;
    const lift = flight.arc ?? 0.05;
    cols.forEach((_, i) => {
      const g = refs.current[i];
      const sh = shadows.current[i];
      if (!g || !sh) return;
      const start = flight.start + i * STAGGER.chipColumn;
      const t = (now - start) / flight.duration;
      const landT = (now - start - flight.duration) / 1000;
      if (t < 0 || landT > DUR.chipSettle / 1000) {
        g.visible = sh.visible = false;
        return;
      }
      g.visible = sh.visible = true;
      const p = clamp01(t);
      // 位置：先加速后摩擦减速（像被手推出去）
      const e = ease.outCubic(ease.inOutSine(p) * 0.35 + p * 0.65);
      const [ox, oz] = offs[i];
      const h = Math.sin(p * Math.PI) * lift + (p < 0.1 ? (p / 0.1) * 0.02 : 0.02 * (1 - p));
      const landing = landT > 0 ? settle(landT, 0.012, 34, 16) : 0;
      const x = fx + (tx - fx) * e + ox * e;
      const z = fz + (tz - fz) * e + oz * e;
      const y = fy + (ty - fy) * e + h + landing;
      g.position.set(x, y, z);
      // 滑动时有轻微倾斜（前缘略抬）与转动
      g.rotation.set(Math.sin(p * Math.PI) * 0.06, p * 1.4 + i, Math.sin(p * Math.PI) * 0.04);
      const above = Math.max(0, y - TABLE_Y);
      sh.position.set(x, TABLE_Y + 0.0015, z);
      sh.scale.setScalar(CHIP_R * (2.8 + above * 3));
      shadowMats[i].opacity = 0.5 / (1 + above * 6);
    });
    if (!played.current && now > flight.start + flight.duration) {
      played.current = true;
      sound.play(flight.amount > 300 ? 'chips' : 'chip', 0, { x: tx, z: tz });
    }
  });
  if (!flight) return null;
  return (
    <>
      {cols.map((c, i) => (
        <group key={c.value}>
          <group ref={(r) => (refs.current[i] = r)} visible={false}>
            <ChipColumn value={c.value} count={c.count} seed={id + i} />
          </group>
          <mesh ref={(r) => (shadows.current[i] = r)} geometry={shadowGeo} material={shadowMats[i]} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={1} />
        </group>
      ))}
    </>
  );
}

export function ChipFlights() {
  const ids = useFx((s) => s.flights.map((f) => f.id).join(','));
  return (
    <>
      {ids
        .split(',')
        .filter(Boolean)
        .map((id) => (
          <FlyingChips key={id} id={Number(id)} />
        ))}
    </>
  );
}
