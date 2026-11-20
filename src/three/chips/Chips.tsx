import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { chipSideTexture, chipTopTexture } from '../textures';
import { useFx } from '../../store/fxStore';
import { sound } from '../../audio/sound';
import { DUR, STAGGER, arc, clamp01, ease, settle } from '../../animation/motion';

export const DENOMS: { value: number; color: string; label: string }[] = [
  { value: 100000, color: '#2bb3c0', label: '10万' },
  { value: 25000, color: '#e94f9a', label: '2.5万' },
  { value: 5000, color: '#f07b22', label: '5K' },
  { value: 1000, color: '#e8b923', label: '1K' },
  { value: 500, color: '#7d4fd1', label: '500' },
  { value: 100, color: '#24242a', label: '100' },
  { value: 25, color: '#2e9d5b', label: '25' },
  { value: 5, color: '#d63b3b', label: '5' },
  { value: 1, color: '#f4f1ea', label: '1' },
];

const CHIP_R = 0.105;
const CHIP_H = 0.026;
const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 28);
const matCache = new Map<number, THREE.Material[]>();

function chipMats(value: number) {
  let m = matCache.get(value);
  if (!m) {
    const d = DENOMS.find((x) => x.value === value)!;
    const side = new THREE.MeshStandardMaterial({ map: chipSideTexture(d.color), roughness: 0.35, metalness: 0.15 });
    const top = new THREE.MeshStandardMaterial({ map: chipTopTexture(d.color, d.label), roughness: 0.3, metalness: 0.15 });
    m = [side, top, top];
    matCache.set(value, m);
  }
  return m;
}

/** 将金额拆分为筹码（每种面额最多显示 10 枚） */
export function breakdown(amount: number, max = 10): { value: number; count: number }[] {
  const out: { value: number; count: number }[] = [];
  let rest = Math.round(amount);
  for (const d of DENOMS) {
    const c = Math.floor(rest / d.value);
    if (c > 0) {
      out.push({ value: d.value, count: Math.min(c, max) });
      rest -= c * d.value;
    }
  }
  return out;
}

const COLUMN_OFFSETS: [number, number][] = [
  [0, 0],
  [0.23, 0.02],
  [-0.12, 0.2],
  [0.12, -0.2],
  [-0.23, -0.04],
  [0.1, 0.22],
  [-0.12, -0.21],
  [0.26, 0.24],
  [-0.26, 0.22],
];

/** 底池整齐排列：按面额分列，两排对齐 */
function neatOffset(i: number, n: number): [number, number] {
  const perRow = Math.min(5, n);
  const row = Math.floor(i / perRow);
  const inRow = Math.min(perRow, n - row * perRow);
  const col = i % perRow;
  return [(col - (inRow - 1) / 2) * 0.235, row * 0.235 - (n > perRow ? 0.117 : 0)];
}

export const ChipStack = memo(function ChipStack({ amount, seed = 0, neat = false, max = 10 }: { amount: number; seed?: number; neat?: boolean; max?: number }) {
  const cols = useMemo(() => breakdown(amount, max), [amount, max]);
  return (
    <group>
      {cols.map((c, ci) => {
        const [ox, oz] = neat ? neatOffset(ci, cols.length) : COLUMN_OFFSETS[ci % COLUMN_OFFSETS.length];
        return (
          <group key={c.value} position={[ox, 0, oz]}>
            <ChipColumn value={c.value} count={c.count} seed={seed + ci} />
          </group>
        );
      })}
    </group>
  );
});

function ChipColumn({ value, count, seed }: { value: number; count: number; seed: number }) {
  const mats = chipMats(value);
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <mesh
          key={i}
          geometry={chipGeo}
          material={mats}
          position={[Math.sin(i * 2.3 + seed) * 0.005, CHIP_H / 2 + i * CHIP_H, Math.cos(i * 1.7 + seed) * 0.005]}
          rotation={[0, i * 0.7 + seed, 0]}
          castShadow={i === count - 1}
          receiveShadow
        />
      ))}
    </>
  );
}

/**
 * 金额显示的延迟：增加时等筹码飞到再显示（delayUp），减少时立即生效（筹码已经飞走）
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

/** 静态筹码堆：新筹码落下时 压扁 → 弹起 → 稳定 */
export function ChipPile({ amount, position, delay = DUR.chipFlight + 120, neat = false }: { amount: number; position: [number, number, number]; delay?: number; neat?: boolean }) {
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
    const t = (performance.now() - pop.current) / 1000;
    const k = t < 0.6 ? settle(t, 0.14, 22, 8) : 0;
    ref.current.scale.set(1 - k * 0.4, 1 + k, 1 - k * 0.4);
  });
  if (shown <= 0) return null;
  return (
    <group ref={ref} position={position}>
      <ChipStack amount={shown} seed={position[0] * 3} neat={neat} max={neat ? 14 : 10} />
    </group>
  );
}

/**
 * 筹码飞行：每一列筹码依次被抛起，沿弧线旋转着飞向目标，落下后轻弹一下
 */
function FlyingChips({ id }: { id: number }) {
  const flight = useFx((s) => s.flights.find((f) => f.id === id));
  const cols = useMemo(() => (flight ? breakdown(flight.amount, 6) : []), [flight?.amount]); // eslint-disable-line
  const refs = useRef<(THREE.Group | null)[]>([]);
  const played = useRef(false);
  const offs = useMemo(() => cols.map((_, i) => [Math.sin(i * 2.1 + id) * 0.12, Math.cos(i * 1.3 + id) * 0.12] as [number, number]), [cols, id]);
  useFrame(() => {
    if (!flight) return;
    const now = performance.now();
    const [fx, fy, fz] = flight.from;
    const [tx, ty, tz] = flight.to;
    const height = Math.min(0.9, 0.35 + Math.hypot(tx - fx, tz - fz) * 0.12);
    let allDone = true;
    cols.forEach((_, i) => {
      const g = refs.current[i];
      if (!g) return;
      const start = flight.start + i * STAGGER.chipColumn;
      const t = (now - start) / flight.duration;
      if (t < 0) {
        g.visible = false;
        allDone = false;
        return;
      }
      const landT = (now - start - flight.duration) / 1000;
      if (landT > DUR.chipSettle / 1000) {
        g.visible = false;
        return;
      }
      allDone = false;
      g.visible = true;
      const p = clamp01(t);
      const e = ease.inOutCubic(p);
      const [ox, oz] = offs[i];
      // 先轻微抬起（被拿起），再沿弧线飞行
      const lift = p < 0.12 ? ease.outQuad(p / 0.12) * 0.06 : 0.06 * (1 - ease.inQuad((p - 0.12) / 0.88));
      const landing = landT > 0 ? settle(landT, 0.025, 30, 14) : 0;
      g.position.set(fx + (tx - fx) * e + ox * e, fy + (ty - fy) * e + arc(p, height) + lift + landing, fz + (tz - fz) * e + oz * e);
      g.rotation.set(Math.sin(p * Math.PI) * 0.5, p * 4 + i, Math.sin(p * Math.PI * 2) * 0.25);
    });
    if (!played.current && now > flight.start + flight.duration) {
      played.current = true;
      sound.play(flight.amount > 500 ? 'chips' : 'chip');
    }
    void allDone;
  });
  if (!flight) return null;
  return (
    <>
      {cols.map((c, i) => (
        <group key={c.value} ref={(r) => (refs.current[i] = r)} visible={false}>
          <ChipColumn value={c.value} count={c.count} seed={id + i} />
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
