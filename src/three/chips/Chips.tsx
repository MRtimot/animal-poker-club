import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { chipSideTexture, chipTopTexture } from '../textures';
import { useFx } from '../../store/fxStore';
import { sound } from '../../audio/sound';

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
export function breakdown(amount: number): { value: number; count: number }[] {
  const out: { value: number; count: number }[] = [];
  let rest = Math.round(amount);
  for (const d of DENOMS) {
    const c = Math.floor(rest / d.value);
    if (c > 0) {
      out.push({ value: d.value, count: Math.min(c, 10) });
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

export const ChipStack = memo(function ChipStack({ amount, seed = 0 }: { amount: number; seed?: number }) {
  const cols = useMemo(() => breakdown(amount), [amount]);
  return (
    <group>
      {cols.map((c, ci) => {
        const [ox, oz] = COLUMN_OFFSETS[ci % COLUMN_OFFSETS.length];
        const mats = chipMats(c.value);
        return (
          <group key={c.value} position={[ox, 0, oz]}>
            {Array.from({ length: c.count }, (_, i) => (
              <mesh
                key={i}
                geometry={chipGeo}
                material={mats}
                position={[Math.sin(i * 2.3 + seed) * 0.006, CHIP_H / 2 + i * CHIP_H, Math.cos(i * 1.7 + seed) * 0.006]}
                rotation={[0, i * 0.7 + seed, 0]}
                castShadow={i === c.count - 1}
                receiveShadow
              />
            ))}
          </group>
        );
      })}
    </group>
  );
});

/** 金额变化延迟显示，配合筹码飞行动画 */
export function useDelayedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

/** 静态筹码堆：带出现时的轻微弹出动画 */
export function ChipPile({ amount, position, delay = 380 }: { amount: number; position: [number, number, number]; delay?: number }) {
  const shown = useDelayedValue(amount, delay);
  const ref = useRef<THREE.Group>(null!);
  const pop = useRef(0);
  useEffect(() => {
    pop.current = performance.now();
  }, [shown]);
  useFrame(() => {
    if (!ref.current) return;
    const t = (performance.now() - pop.current) / 250;
    const s = t < 1 ? 1 + Math.sin(t * Math.PI) * 0.12 : 1;
    ref.current.scale.setScalar(s);
  });
  if (shown <= 0) return null;
  return (
    <group ref={ref} position={position}>
      <ChipStack amount={shown} seed={position[0] * 3} />
    </group>
  );
}

function FlyingChips({ id }: { id: number }) {
  const ref = useRef<THREE.Group>(null!);
  const flight = useFx((s) => s.flights.find((f) => f.id === id));
  const played = useRef(false);
  useFrame(() => {
    if (!flight || !ref.current) return;
    const now = performance.now();
    const p = (now - flight.start) / flight.duration;
    if (p < 0 || p > 1) {
      ref.current.visible = false;
      if (p > 1 && !played.current) {
        played.current = true;
        sound.play(flight.amount > 500 ? 'chips' : 'chip');
      }
      return;
    }
    ref.current.visible = true;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const [fx, fy, fz] = flight.from;
    const [tx, ty, tz] = flight.to;
    ref.current.position.set(fx + (tx - fx) * e, fy + (ty - fy) * e + Math.sin(p * Math.PI) * 0.45, fz + (tz - fz) * e);
    ref.current.rotation.y = p * 2;
  });
  if (!flight) return null;
  return (
    <group ref={ref} visible={false}>
      <ChipStack amount={flight.amount} seed={id} />
    </group>
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
