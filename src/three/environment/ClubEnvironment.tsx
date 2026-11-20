import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { emojiTexture, forestWindowTexture, neonTexture, rugTexture, wallTexture, woodTexture, feltTexture } from '../textures';
import { GEO, mat } from '../animals/materials';
import { TABLE_R, TABLE_Y } from '../layout';
import type { Quality } from '../../store/settingsStore';

const ROOM_R = 15;
// 天花板要高于俯视镜头（竖屏时镜头高约 14）
const ROOM_H = 16;

function Plant({ position, scale = 1, kind = 0 }: { position: [number, number, number]; scale?: number; kind?: number }) {
  const leaf = kind % 2 ? '#3f8f4a' : '#2f7a3e';
  return (
    <group position={position} scale={scale}>
      <mesh geometry={GEO.cyl} material={mat('#b5643c', { rough: 0.8 })} position={[0, 0.35, 0]} scale={[0.45, 0.7, 0.45]} castShadow />
      <mesh geometry={GEO.cyl} material={mat('#3a2a1a')} position={[0, 0.71, 0]} scale={[0.42, 0.03, 0.42]} />
      {kind < 2 ? (
        <>
          <mesh geometry={GEO.cyl} material={mat('#5a3a22')} position={[0, 1.3, 0]} scale={[0.06, 1.2, 0.06]} />
          {[
            [0, 2.0, 0, 0.7],
            [0.35, 1.7, 0.1, 0.5],
            [-0.3, 1.75, -0.15, 0.55],
            [0.05, 2.45, 0.1, 0.5],
          ].map(([x, y, z, s], i) => (
            <mesh key={i} geometry={GEO.sphereLow} material={mat(i % 2 ? leaf : '#4a9c52', { rough: 0.9 })} position={[x, y, z]} scale={s} castShadow />
          ))}
        </>
      ) : (
        Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * Math.PI * 2;
          return (
            <mesh key={i} geometry={GEO.sphereLow} material={mat(leaf, { rough: 0.9 })} position={[Math.sin(a) * 0.35, 1.05 + (i % 3) * 0.1, Math.cos(a) * 0.35]} scale={[0.12, 0.5, 0.28]} rotation={[Math.cos(a) * 0.6, a, -Math.sin(a) * 0.6]} />
          );
        })
      )}
    </group>
  );
}

function StringLights({ count, radius, y }: { count: number; radius: number; y: number }) {
  const bulbs = useMemo(() => {
    const out: { p: [number, number, number]; c: string }[] = [];
    const colors = ['#ffd27a', '#ff9f7a', '#ffe9a8', '#ffb3d1'];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sag = Math.abs(Math.sin(a * 6)) * -0.5;
      out.push({ p: [Math.sin(a) * radius, y + sag, Math.cos(a) * radius], c: colors[i % colors.length] });
    }
    return out;
  }, [count, radius, y]);
  return (
    <>
      {bulbs.map((b, i) => (
        <mesh key={i} geometry={GEO.sphereLow} material={mat(b.c, { emissive: b.c, ei: 2.2, rough: 0.3 })} position={b.p} scale={0.07} />
      ))}
    </>
  );
}

function Fireflies({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null!);
  const { geo, seeds } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 8;
      pos[i * 3] = Math.sin(a) * r;
      pos[i * 3 + 1] = 0.5 + Math.random() * 5;
      pos[i * 3 + 2] = Math.cos(a) * r;
      seeds[i] = Math.random() * 100;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geo: g, seeds };
  }, [count]);
  const base = useMemo(() => (geo.getAttribute('position').array as Float32Array).slice(), [geo]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const arr = geo.getAttribute('position').array as Float32Array;
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      arr[i * 3] = base[i * 3] + Math.sin(t * 0.3 + s) * 0.4;
      arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.5 + s * 2) * 0.3;
      arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.35 + s) * 0.4;
    }
    geo.getAttribute('position').needsUpdate = true;
    (ref.current.material as THREE.PointsMaterial).opacity = 0.6 + Math.sin(t * 2) * 0.2;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#ffe98a" size={0.07} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function Portrait({ emoji, position, rotY, bg }: { emoji: string; position: [number, number, number]; rotY: number; bg: string }) {
  const tex = useMemo(() => emojiTexture(emoji, bg), [emoji, bg]);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh geometry={GEO.box} material={mat('#c9a227', { rough: 0.35, metal: 0.7 })} scale={[1.25, 1.55, 0.08]} />
      <mesh position={[0, 0, 0.05]}>
        <planeGeometry args={[1.05, 1.35]} />
        <meshStandardMaterial map={tex} roughness={0.8} />
      </mesh>
    </group>
  );
}

/** 森林动物扑克俱乐部：木地板、墙面、窗外森林、植物、灯串、霓虹灯 */
export function ClubEnvironment({ quality }: { quality: Quality }) {
  const floor = useMemo(() => woodTexture('floor', '#8a5a35', [8, 8]), []);
  const wall = useMemo(() => wallTexture(), []);
  const rug = useMemo(() => rugTexture(), []);
  const neon = useMemo(() => neonTexture('动物扑克俱乐部', '#ff5fa8', 'neon-title'), []);
  const neon2 = useMemo(() => neonTexture('♠ ♥ ♦ ♣', '#5fe1ff', 'neon-suits'), []);
  const rich = quality === 'high' || quality === 'ultra';

  const windows = useMemo(() => {
    const out: { a: number; seed: number }[] = [];
    for (let i = 0; i < 7; i++) out.push({ a: Math.PI * 0.72 + i * ((Math.PI * 2 - Math.PI * 0.44) / 7) + 0.25, seed: i });
    return out;
  }, []);

  return (
    <group>
      {/* 地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[ROOM_R, 64]} />
        <meshStandardMaterial map={floor} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <circleGeometry args={[6.4, 64]} />
        <meshStandardMaterial map={rug} roughness={0.95} />
      </mesh>

      {/* 墙 */}
      <mesh position={[0, ROOM_H / 2, 0]}>
        <cylinderGeometry args={[ROOM_R, ROOM_R, ROOM_H, 64, 1, true]} />
        <meshStandardMaterial map={wall} side={THREE.BackSide} roughness={0.9} />
      </mesh>
      <mesh position={[0, ROOM_H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[ROOM_R, 48]} />
        <meshStandardMaterial color="#2a1a14" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* 屋顶木梁 */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} geometry={GEO.box} material={mat('#3d2519')} position={[0, ROOM_H - 0.4, 0]} rotation={[0, (i * Math.PI) / 4, 0]} scale={[ROOM_R * 2, 0.35, 0.4]} />
      ))}

      {/* 窗户：窗外是夜晚的森林 */}
      {windows.map(({ a, seed }) => (
        <group key={seed} position={[Math.sin(a) * (ROOM_R - 0.05), 3.6, Math.cos(a) * (ROOM_R - 0.05)]} rotation={[0, a + Math.PI, 0]}>
          <mesh geometry={GEO.box} material={mat('#2a1a12')} scale={[3.2, 4.0, 0.2]} />
          <mesh position={[0, 0, 0.11]}>
            <planeGeometry args={[2.9, 3.7]} />
            <meshBasicMaterial map={forestWindowTexture(seed)} toneMapped={false} />
          </mesh>
          <mesh geometry={GEO.box} material={mat('#3d2519')} position={[0, -2.05, 0.2]} scale={[3.4, 0.15, 0.4]} />
        </group>
      ))}

      {/* 霓虹灯牌 */}
      <group position={[0, 5.6, -ROOM_R + 0.15]}>
        <mesh>
          <planeGeometry args={[8, 2]} />
          <meshBasicMaterial map={neon} transparent toneMapped={false} />
        </mesh>
        <mesh position={[0, -1.2, 0]}>
          <planeGeometry args={[4, 1]} />
          <meshBasicMaterial map={neon2} transparent toneMapped={false} />
        </mesh>
      </group>

      {/* 动物肖像装饰 */}
      {[
        ['🦁', -0.5, '#f6e7c8'],
        ['🐼', 0.5, '#e6f0e6'],
        ['🦊', -2.6, '#f6dcc8'],
        ['🐸', 2.6, '#dcefd0'],
      ].map(([e, a, bg]) => {
        const ang = Math.PI + (a as number) * 0.5;
        return (
          <Portrait key={e as string} emoji={e as string} bg={bg as string} position={[Math.sin(ang) * (ROOM_R - 0.2), 3.4, Math.cos(ang) * (ROOM_R - 0.2)]} rotY={ang + Math.PI} />
        );
      })}

      {/* 植物 */}
      {[
        [9, 0, 7, 1.4, 0],
        [-9.5, 0, 6, 1.2, 1],
        [11, 0, -4, 1.5, 2],
        [-11, 0, -5, 1.6, 0],
        [6, 0, -11, 1.3, 1],
        [-6, 0, -11, 1.1, 2],
        [12.5, 0, 2, 1.0, 2],
        [-12.5, 0, 1, 1.0, 1],
      ]
        .slice(0, rich ? 8 : 4)
        .map(([x, y, z, s, k], i) => (
          <Plant key={i} position={[x, y, z]} scale={s} kind={k} />
        ))}

      {/* 灯串 */}
      <StringLights count={rich ? 90 : 48} radius={ROOM_R - 0.4} y={7.2} />

      {/* 吊灯 */}
      {/* 吊灯挂得比俯视镜头更高，避免挡住远处的玩家 */}
      <group position={[0, 12.2, 0]}>
        <mesh geometry={GEO.cyl} material={mat('#1b1b1f')} position={[0, (ROOM_H - 12.2) / 2, 0]} scale={[0.02, ROOM_H - 12.2, 0.02]} />
        <mesh geometry={GEO.cone} material={mat('#1f5c3d', { rough: 0.4, metal: 0.5 })} scale={[1.5, 0.8, 1.5]} />
        <mesh geometry={GEO.sphereLow} material={mat('#fff3c4', { emissive: '#fff3c4', ei: 3 })} position={[0, -0.35, 0]} scale={0.25} />
      </group>

      {rich && <Fireflies count={quality === 'ultra' ? 120 : 60} />}
    </group>
  );
}

/** 大型圆形扑克桌 */
export function PokerTableMesh() {
  const felt = useMemo(() => feltTexture(), []);
  const wood = useMemo(() => woodTexture('tablewood', '#6b3a1f', [4, 1]), []);
  return (
    <group>
      {/* 桌面绒布 */}
      <mesh position={[0, TABLE_Y - 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.06, 96]} />
        <meshStandardMaterial attach="material-0" color="#174f33" roughness={0.95} />
        <meshStandardMaterial attach="material-1" map={felt} roughness={0.95} />
        <meshStandardMaterial attach="material-2" color="#174f33" roughness={0.95} />
      </mesh>
      {/* 皮质包边 */}
      <mesh position={[0, TABLE_Y + 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[TABLE_R + 0.12, 0.2, 20, 96]} />
        <meshStandardMaterial color="#4a2416" roughness={0.45} metalness={0.05} />
      </mesh>
      {/* 金色装饰线 */}
      <mesh position={[0, TABLE_Y + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[TABLE_R - 0.08, TABLE_R - 0.04, 96]} />
        <meshStandardMaterial color="#e8c25a" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* 木质桌裙 */}
      <mesh position={[0, TABLE_Y - 0.22, 0]} castShadow>
        <cylinderGeometry args={[TABLE_R + 0.2, TABLE_R - 0.2, 0.36, 96, 1, true]} />
        <meshStandardMaterial map={wood} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      {/* 桌腿底座 */}
      <mesh geometry={GEO.cyl} material={mat('#3d2014', { rough: 0.5 })} position={[0, 0.4, 0]} scale={[0.6, 0.8, 0.6]} castShadow />
      <mesh geometry={GEO.cyl} material={mat('#3d2014', { rough: 0.5 })} position={[0, 0.06, 0]} scale={[1.6, 0.12, 1.6]} castShadow receiveShadow />
    </group>
  );
}

/** 动物座椅 */
export function Chair({ position, rotY, color = '#7a1f2b' }: { position: [number, number, number]; rotY: number; color?: string }) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh geometry={GEO.cyl} material={mat(color, { rough: 0.6 })} position={[0, 0.5, 0]} scale={[0.62, 0.14, 0.62]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={mat(color, { rough: 0.6 })} position={[0, 1.15, -0.55]} scale={[1.05, 1.25, 0.14]} castShadow />
      <mesh geometry={GEO.cyl} material={mat('#c9a227', { rough: 0.3, metal: 0.8 })} position={[0, 0.22, 0]} scale={[0.06, 0.5, 0.06]} />
      <mesh geometry={GEO.cyl} material={mat('#2a1a12')} position={[0, 0.02, 0]} scale={[0.4, 0.04, 0.4]} />
    </group>
  );
}
