import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Burst, useFx } from '../../store/fxStore';
import { emojiTexture } from '../textures';

const confettiGeo = new THREE.PlaneGeometry(0.07, 0.11);
const PALETTE = ['#ff5fa8', '#ffd84a', '#5fe1ff', '#7dff8a', '#b07bff', '#ff8a4a', '#ffffff'];

function BurstFx({ burst, count }: { burst: Burst; count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const data = useMemo(() => {
    const v: THREE.Vector3[] = [];
    const spin: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = burst.kind === 'confetti' ? 3.5 + Math.random() * 3 : 1 + Math.random() * 1.6;
      const out = burst.kind === 'confetti' ? 1 + Math.random() * 2 : 0.5 + Math.random();
      v.push(new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out));
      spin.push(new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8));
    }
    return { v, spin };
  }, [burst.id, count, burst.kind]);

  const material = useMemo(() => {
    if (burst.kind === 'hearts') return new THREE.MeshBasicMaterial({ map: emojiTexture('❤️', 'rgba(0,0,0,0)'), transparent: true, side: THREE.DoubleSide, depthWrite: false });
    if (burst.kind === 'fire') return new THREE.MeshBasicMaterial({ color: '#ff7a2a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    if (burst.kind === 'sparkle') return new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    return new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0.2 });
  }, [burst.kind]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (burst.kind !== 'confetti') return;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) ref.current.setColorAt(i, c.set(PALETTE[i % PALETTE.length]));
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [burst.id, count, burst.kind]);

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const s = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const t = (performance.now() - burst.start) / 1000;
    const g = burst.kind === 'confetti' ? 4.5 : burst.kind === 'hearts' ? -0.3 : 0.8;
    const life = burst.kind === 'confetti' ? 3 : 1.8;
    const fade = Math.max(0, 1 - t / life);
    if ('opacity' in material) (material as any).opacity = Math.min(1, fade * 2);
    for (let i = 0; i < count; i++) {
      const v = data.v[i];
      const drag = burst.kind === 'confetti' ? Math.min(t, 0.9) : t;
      p.set(burst.position[0] + v.x * drag, burst.position[1] + v.y * t - 0.5 * g * t * t, burst.position[2] + v.z * drag);
      if (burst.kind === 'confetti' && p.y < 1.02) p.y = 1.02;
      e.set(data.spin[i].x * t, data.spin[i].y * t, data.spin[i].z * t);
      q.setFromEuler(e);
      const sc = burst.kind === 'hearts' ? 3 * fade + 0.5 : burst.kind === 'confetti' ? 1 : 1.4 * fade;
      s.set(sc, sc, sc);
      m.compose(p, burst.kind === 'hearts' ? new THREE.Quaternion() : q, s);
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[confettiGeo, material, count]} frustumCulled={false} />;
}

export function Bursts({ density = 1 }: { density?: number }) {
  const bursts = useFx((s) => s.bursts);
  return (
    <>
      {bursts.map((b) => (
        <BurstFx key={b.id} burst={b} count={Math.round((b.kind === 'confetti' ? 140 : b.kind === 'hearts' ? 10 : 50) * density)} />
      ))}
    </>
  );
}
