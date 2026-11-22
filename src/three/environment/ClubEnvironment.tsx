import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { forestWindowTexture } from '../textures';
import { GEO, mat } from '../animals/materials';
import { TABLE_R, TABLE_Y } from '../layout';
import { useSettings, type Quality } from '../../store/settingsStore';
import { carpetMaps, feltMaps, leatherNormal, plankFloorMaps, salonWallMaps, skylineTexture, woodMaps } from '../realism';

const ROOM_R = 15;
// 天花板要高于竖屏俯视镜头（约 15），房间本身保持昏暗，视线集中在牌桌
const ROOM_H = 16;
/** 吊灯高度：横屏俯视镜头看不到它，电影镜头中会出现在画面上方 */
export const LAMP_Y = 8.6;

export const THEME = {
  casino: { floor: '#3a2416', wallLight: '#ffc98a', accent: '#b8902f', leather: '#2a1410', chair: '#3b1416' },
  penthouse: { floor: '#4a4038', wallLight: '#ffe1b8', accent: '#9a9aa2', leather: '#1c1c1f', chair: '#26262b' },
  cabin: { floor: '#6a4428', wallLight: '#ffb070', accent: '#a07040', leather: '#4a2a18', chair: '#5a2a1c' },
} as const;

// —— 共享的写实材质 ——
const matCache = new Map<string, THREE.Material>();
function pmat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m as T;
}
const brass = () => pmat('brass', () => new THREE.MeshStandardMaterial({ color: '#b58a3c', metalness: 1, roughness: 0.32 }));
const chrome = () => pmat('chrome', () => new THREE.MeshStandardMaterial({ color: '#d8d8dc', metalness: 1, roughness: 0.18 }));
const blackMetal = () => pmat('blackMetal', () => new THREE.MeshStandardMaterial({ color: '#141416', metalness: 0.7, roughness: 0.45 }));
export function leather(color: string) {
  return pmat(
    'leather' + color,
    () =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.48,
        clearcoat: 0.25,
        clearcoatRoughness: 0.5,
        normalMap: leatherNormal(),
        normalScale: new THREE.Vector2(0.5, 0.5),
        sheen: 0.3,
        sheenRoughness: 0.6,
        sheenColor: new THREE.Color('#5a4030'),
      }),
  );
}
function lacqueredWood(key: string, base: string, repeat: [number, number]) {
  return pmat('lw' + key, () => {
    const w = woodMaps(key, base, repeat, 0.5);
    return new THREE.MeshPhysicalMaterial({ map: w.map, normalMap: w.normalMap, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.18 });
  });
}

/** 壁灯：黄铜底座 + 布艺灯罩（暖光） */
function Sconce({ angle, y, color }: { angle: number; y: number; color: string }) {
  const r = ROOM_R - 0.15;
  return (
    <group position={[Math.sin(angle) * r, y, Math.cos(angle) * r]} rotation={[0, angle + Math.PI, 0]}>
      <mesh geometry={GEO.box} material={brass()} position={[0, 0, 0.04]} scale={[0.18, 0.32, 0.06]} />
      <mesh geometry={GEO.cyl} material={brass()} position={[0, 0.05, 0.22]} rotation={[Math.PI / 2, 0, 0]} scale={[0.025, 0.36, 0.025]} />
      <mesh geometry={GEO.cylOpen} material={mat(color, { emissive: color, ei: 0.9, rough: 0.9 })} position={[0, 0.22, 0.4]} scale={[0.2, 0.28, 0.2]} />
      <mesh geometry={GEO.sphereLow} material={mat('#fff1d6', { emissive: '#ffd9a0', ei: 2.4 })} position={[0, 0.18, 0.4]} scale={0.07} />
    </group>
  );
}

/** 写实盆栽：细长叶片向外舒展 */
function Plant({ position, scale = 1, seed = 0 }: { position: [number, number, number]; scale?: number; seed?: number }) {
  const leaves = useMemo(() => {
    const out: { p: [number, number, number]; r: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seed;
      const h = 1.1 + (i % 5) * 0.28;
      const tilt = 0.5 + (i % 3) * 0.22;
      out.push({
        p: [Math.sin(a) * 0.32, h, Math.cos(a) * 0.32],
        r: [Math.cos(a) * tilt, a, -Math.sin(a) * tilt],
        s: [0.11, 0.5, 0.025],
        c: ['#2d5a2e', '#3a6b34', '#25492a'][i % 3],
      });
    }
    return out;
  }, [seed]);
  return (
    <group position={position} scale={scale}>
      <mesh geometry={GEO.cyl} material={pmat('pot', () => new THREE.MeshStandardMaterial({ color: '#2b2a28', roughness: 0.65, metalness: 0.1 }))} position={[0, 0.4, 0]} scale={[0.42, 0.8, 0.42]} castShadow receiveShadow />
      <mesh geometry={GEO.cyl} material={mat('#2a1d14', { rough: 1 })} position={[0, 0.79, 0]} scale={[0.39, 0.02, 0.39]} />
      {leaves.map((l, i) => (
        <mesh key={i} geometry={GEO.sphereLow} material={mat(l.c, { rough: 0.7 })} position={l.p} rotation={l.r} scale={l.s} castShadow />
      ))}
    </group>
  );
}

/** 皮质沙发（切斯特菲尔德风格的简化体块） */
function Sofa({ position, rotY, color }: { position: [number, number, number]; rotY: number; color: string }) {
  const m = leather(color);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh geometry={GEO.box} material={m} position={[0, 0.42, 0]} scale={[3.2, 0.46, 1.2]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={m} position={[0, 0.95, -0.5]} scale={[3.2, 0.95, 0.3]} castShadow />
      {[-1, 1].map((x) => (
        <mesh key={x} geometry={GEO.capsule} material={m} position={[x * 1.62, 0.78, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.2, 0.75, 0.2]} castShadow />
      ))}
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} geometry={GEO.box} material={m} position={[x, 0.72, 0.05]} scale={[1.5, 0.16, 1.0]} castShadow />
      ))}
      {[-1.4, 1.4].map((x) =>
        [-0.45, 0.45].map((z) => <mesh key={`${x}${z}`} geometry={GEO.cyl} material={brass()} position={[x, 0.09, z]} scale={[0.05, 0.18, 0.05]} />),
      )}
    </group>
  );
}

/** 吧台酒柜：木质柜体 + 玻璃酒瓶 + 柜内灯带 */
function BarShelf({ angle }: { angle: number }) {
  const r = ROOM_R - 0.55;
  const bottles = useMemo(() => {
    const cols = ['#4a2a10', '#1f3a22', '#6a4a18', '#2a2a40', '#7a2a18', '#d8c890'];
    const out: { x: number; y: number; c: string; h: number }[] = [];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 14; i++) out.push({ x: -2.6 + i * 0.4 + (row % 2) * 0.12, y: 1.33 + row * 0.95, c: cols[(i * 7 + row * 3) % cols.length], h: 0.38 + ((i + row) % 3) * 0.06 });
    }
    return out;
  }, []);
  const glass = (c: string) =>
    pmat('glass' + c, () => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.78, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const wood = lacqueredWood('bar', '#3a2010', [2, 1]);
  return (
    <group position={[Math.sin(angle) * r, 0, Math.cos(angle) * r]} rotation={[0, angle + Math.PI, 0]}>
      <mesh geometry={GEO.box} material={wood} position={[0, 2.2, -0.15]} scale={[6.2, 4.4, 0.25]} receiveShadow />
      {[1.3, 2.25, 3.2].map((y) => (
        <group key={y}>
          <mesh geometry={GEO.box} material={wood} position={[0, y, 0.12]} scale={[6, 0.06, 0.5]} />
          <mesh geometry={GEO.box} material={mat('#ffcf8a', { emissive: '#ffb860', ei: 1.4 })} position={[0, y - 0.04, 0.32]} scale={[5.8, 0.012, 0.02]} />
        </group>
      ))}
      {bottles.map((b, i) => (
        <group key={i} position={[b.x, b.y, 0.12]}>
          <mesh geometry={GEO.cyl} material={glass(b.c)} position={[0, b.h / 2, 0]} scale={[0.07, b.h, 0.07]} />
          <mesh geometry={GEO.cyl} material={glass(b.c)} position={[0, b.h + 0.07, 0]} scale={[0.025, 0.14, 0.025]} />
        </group>
      ))}
      {/* 吧台 */}
      <mesh geometry={GEO.box} material={wood} position={[0, 0.55, 1.1]} scale={[6.4, 1.1, 0.8]} castShadow receiveShadow />
      <mesh
        geometry={GEO.box}
        material={pmat('marble', () => new THREE.MeshPhysicalMaterial({ color: '#d9d4cc', roughness: 0.18, clearcoat: 0.6 }))}
        position={[0, 1.13, 1.1]}
        scale={[6.6, 0.06, 0.95]}
        receiveShadow
      />
      <mesh geometry={GEO.cyl} material={brass()} position={[0, 0.18, 1.55]} rotation={[0, 0, Math.PI / 2]} scale={[0.03, 6.2, 0.03]} />
    </group>
  );
}

/** 落地窗 + 城市夜景（高层主题）/ 森林夜景（小屋主题） */
function WindowWall({ from, to, theme }: { from: number; to: number; theme: 'penthouse' | 'cabin' }) {
  const panes = theme === 'penthouse' ? 7 : 4;
  const items = useMemo(() => Array.from({ length: panes }, (_, i) => from + ((i + 0.5) / panes) * (to - from)), [from, to, panes]);
  const frame = theme === 'penthouse' ? blackMetal() : lacqueredWood('cabinframe', '#4a2a16', [1, 1]);
  return (
    <>
      {items.map((a, i) => {
        const r = ROOM_R - 0.08;
        const w = ((to - from) / panes) * r * 0.96;
        const h = theme === 'penthouse' ? 7.2 : 3.8;
        const y = theme === 'penthouse' ? 4.2 : 3.4;
        const tex = theme === 'penthouse' ? skylineTexture(i) : forestWindowTexture(i);
        return (
          <group key={i} position={[Math.sin(a) * r, y, Math.cos(a) * r]} rotation={[0, a + Math.PI, 0]}>
            <mesh position={[0, 0, 0.02]}>
              <planeGeometry args={[w - 0.12, h]} />
              <meshBasicMaterial map={tex} color={theme === 'penthouse' ? '#c8c8d0' : '#9a9aa4'} toneMapped={false} />
            </mesh>
            {/* 玻璃反射层 */}
            <mesh position={[0, 0, 0.06]}>
              <planeGeometry args={[w - 0.12, h]} />
              <meshPhysicalMaterial color="#ffffff" roughness={0.04} metalness={0} transparent opacity={0.08} clearcoat={1} />
            </mesh>
            <mesh geometry={GEO.box} material={frame} position={[w / 2, 0, 0.05]} scale={[0.1, h + 0.2, 0.14]} />
            <mesh geometry={GEO.box} material={frame} position={[0, h / 2, 0.05]} scale={[w, 0.12, 0.14]} />
            <mesh geometry={GEO.box} material={frame} position={[0, -h / 2, 0.05]} scale={[w, 0.12, 0.14]} />
          </group>
        );
      })}
    </>
  );
}

/** 壁炉（森林小屋）：火光会轻微闪烁 */
function Fireplace({ angle }: { angle: number }) {
  const light = useRef<THREE.PointLight>(null!);
  const flame = useRef<THREE.Mesh>(null!);
  const r = ROOM_R - 0.5;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = 0.85 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 13.1) * 0.05 + Math.sin(t * 2.1) * 0.04;
    if (light.current) light.current.intensity = 26 * f;
    if (flame.current) flame.current.scale.y = 0.55 * f;
  });
  return (
    <group position={[Math.sin(angle) * r, 0, Math.cos(angle) * r]} rotation={[0, angle + Math.PI, 0]}>
      <mesh geometry={GEO.box} material={mat('#5a5048', { rough: 0.95 })} position={[0, 1.6, -0.2]} scale={[3.4, 3.2, 0.9]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={mat('#100c0a', { rough: 1 })} position={[0, 0.85, 0.2]} scale={[1.8, 1.2, 0.3]} />
      <mesh ref={flame} geometry={GEO.cone} material={mat('#ff9a3a', { emissive: '#ff7a20', ei: 3 })} position={[0, 0.72, 0.25]} scale={[0.5, 0.55, 0.2]} />
      <mesh geometry={GEO.box} material={lacqueredWood('mantel', '#3a2212', [1, 1])} position={[0, 3.25, 0.15]} scale={[3.8, 0.16, 0.7]} />
      <pointLight ref={light} position={[0, 1, 1.2]} color="#ff9a50" intensity={26} distance={12} decay={2} />
    </group>
  );
}

/** 空气中的灰尘颗粒：只在灯光下可见，缓慢漂浮（极其克制） */
function Dust({ count }: { count: number }) {
  const { geo, seeds } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 3;
      pos[i * 3] = Math.sin(a) * r;
      pos[i * 3 + 1] = 1.5 + Math.random() * 6;
      pos[i * 3 + 2] = Math.cos(a) * r;
      seeds[i] = Math.random() * 100;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geo: g, seeds };
  }, [count]);
  const base = useMemo(() => (geo.getAttribute('position').array as Float32Array).slice(), [geo]);
  // 通过 props 传入的几何体不会被自动释放：离开场景时手动释放（否则每次进出牌桌都会残留一份）
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const arr = geo.getAttribute('position').array as Float32Array;
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      arr[i * 3] = base[i * 3] + Math.sin(t * 0.05 + s) * 0.3;
      arr[i * 3 + 1] = base[i * 3 + 1] + ((t * 0.03 + s) % 1) * 0.6;
      arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.04 + s) * 0.3;
    }
    geo.getAttribute('position').needsUpdate = true;
  });
  return (
    <points geometry={geo}>
      <pointsMaterial color="#fff2d8" size={0.022} transparent opacity={0.32} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
    </points>
  );
}

/** 牌桌上方的吊灯：黑色金属灯罩 + 黄铜边 + 柔光扩散板。镜头在灯上方（竖屏俯视）时自动隐藏 */
function PendantLamp() {
  const ref = useRef<THREE.Group>(null!);
  const { camera } = useThree();
  useFrame(() => {
    if (ref.current) ref.current.visible = camera.position.y < LAMP_Y - 0.4;
  });
  return (
    <group ref={ref} position={[0, LAMP_Y, 0]}>
      <mesh geometry={GEO.cyl} material={blackMetal()} position={[0, (ROOM_H - LAMP_Y) / 2 + 0.4, 0]} scale={[0.025, ROOM_H - LAMP_Y, 0.025]} />
      <mesh
        geometry={GEO.cylOpen}
        material={pmat('shade', () => new THREE.MeshStandardMaterial({ color: '#16241c', metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }))}
        position={[0, 0.25, 0]}
        scale={[1.9, 0.5, 1.9]}
      />
      <mesh geometry={GEO.cyl} material={blackMetal()} position={[0, 0.52, 0]} scale={[1.2, 0.08, 1.2]} />
      <mesh geometry={GEO.torusThin} material={brass()} rotation={[Math.PI / 2, 0, 0]} scale={[1.9, 1.9, 1]} />
      <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.85, 48]} />
        <meshStandardMaterial color="#fff4dc" emissive="#ffe2b0" emissiveIntensity={1.6} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** 扑克房间：根据设置切换 豪华赌场 / 夜景高层 / 森林小屋 */
export function ClubEnvironment({ quality }: { quality: Quality }) {
  const theme = useSettings((s) => s.room);
  const T = THEME[theme];
  const floor = useMemo(() => plankFloorMaps(T.floor), [T.floor]);
  const wall = useMemo(() => salonWallMaps(theme), [theme]);
  const carpet = useMemo(() => carpetMaps(theme), [theme]);
  const rich = quality === 'high' || quality === 'ultra';
  const sconces = useMemo(() => Array.from({ length: 10 }, (_, i) => Math.PI * 0.1 + (i / 10) * Math.PI * 2), []);

  return (
    <group>
      {/* 地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[ROOM_R, 64]} />
        <meshStandardMaterial map={floor.map} normalMap={floor.normalMap} normalScale={new THREE.Vector2(0.6, 0.6)} roughness={0.5} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
        <circleGeometry args={[7.2, 64]} />
        <meshStandardMaterial map={carpet.map} normalMap={carpet.normalMap} roughness={0.96} />
      </mesh>

      {/* 墙：上半壁纸、下半护墙板 */}
      <mesh position={[0, ROOM_H / 2, 0]}>
        <cylinderGeometry args={[ROOM_R, ROOM_R, ROOM_H, 72, 1, true]} />
        <meshStandardMaterial map={wall.map} normalMap={wall.normalMap} side={THREE.BackSide} roughness={0.85} />
      </mesh>
      {/* 天花板：只从下方可见（镜头在上方时不会挡住视线） */}
      <mesh position={[0, ROOM_H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[ROOM_R, 48]} />
        <meshStandardMaterial color="#120c0a" roughness={1} />
      </mesh>
      {/* 踢脚线 */}
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[ROOM_R - 0.03, ROOM_R - 0.03, 0.24, 72, 1, true]} />
        <meshStandardMaterial color="#1a100a" roughness={0.5} side={THREE.BackSide} />
      </mesh>

      {/* 壁灯（暖色、克制） */}
      {sconces.map((a, i) => (theme === 'penthouse' && a > Math.PI * 0.62 && a < Math.PI * 1.38 ? null : <Sconce key={i} angle={a} y={3.4} color={T.wallLight} />))}
      {rich &&
        [0.6, 2.2, 3.8, 5.4].map((a) => (
          <pointLight key={a} position={[Math.sin(a) * (ROOM_R - 1), 3.6, Math.cos(a) * (ROOM_R - 1)]} color={T.wallLight} intensity={9} distance={9} decay={2} />
        ))}

      {/* 主题陈设 */}
      {theme === 'casino' && <BarShelf angle={Math.PI} />}
      {theme === 'penthouse' && <WindowWall from={Math.PI * 0.62} to={Math.PI * 1.38} theme="penthouse" />}
      {theme === 'cabin' && (
        <>
          <WindowWall from={Math.PI * 0.7} to={Math.PI * 1.0} theme="cabin" />
          <Fireplace angle={Math.PI * 1.22} />
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} geometry={GEO.box} material={lacqueredWood('beam', '#3a2414', [4, 1])} position={[0, 11, 0]} rotation={[0, (i * Math.PI) / 4, 0]} scale={[ROOM_R * 2, 0.45, 0.5]} />
          ))}
        </>
      )}
      <Sofa position={[Math.sin(0.55 * Math.PI) * 11.3, 0, Math.cos(0.55 * Math.PI) * 11.3]} rotY={0.55 * Math.PI + Math.PI} color={T.leather} />
      <Sofa position={[Math.sin(1.45 * Math.PI) * 11.3, 0, Math.cos(1.45 * Math.PI) * 11.3]} rotY={1.45 * Math.PI + Math.PI} color={T.leather} />
      {(
        [
          [9.5, 6.5, 1.3, 0],
          [-9.8, 6, 1.2, 1],
          [11.5, -4.5, 1.5, 2],
          [-11.5, -4.5, 1.4, 3],
        ] as const
      )
        .slice(0, rich ? 4 : 2)
        .map(([x, z, s, k], i) => (
          <Plant key={i} position={[x, 0, z]} scale={s} seed={k} />
        ))}

      <PendantLamp />
      {rich && <Dust count={quality === 'ultra' ? 140 : 80} />}
    </group>
  );
}

/** 专业扑克桌：绒布台面、木质下注圈、皮质包边、黄铜嵌线、杯架、漆面木桌裙 */
export function PokerTableMesh() {
  const theme = useSettings((s) => s.room);
  const T = THEME[theme];
  const felt = useMemo(() => feltMaps(), []);
  const feltMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: felt.map, normalMap: felt.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.93, metalness: 0 }),
    [felt],
  );
  const feltSide = useMemo(() => new THREE.MeshStandardMaterial({ color: '#174a31', roughness: 0.95 }), []);
  const railMat = leather(T.leather);
  const apron = lacqueredWood('apron', '#4a2412', [6, 1]);
  const race = lacqueredWood('race', '#5a2e16', [12, 1]);
  return (
    <group>
      {/* 桌面绒布 */}
      <mesh position={[0, TABLE_Y - 0.03, 0]} receiveShadow material={[feltSide, feltMat, feltSide]}>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.06, 128]} />
      </mesh>
      {/* 木质下注圈（racetrack） */}
      <mesh position={[0, TABLE_Y + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} material={race} receiveShadow>
        <ringGeometry args={[TABLE_R - 0.24, TABLE_R + 0.02, 128]} />
      </mesh>
      {/* 黄铜嵌线 */}
      <mesh position={[0, TABLE_Y + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} material={brass()}>
        <ringGeometry args={[TABLE_R - 0.26, TABLE_R - 0.24, 128]} />
      </mesh>
      {/* 皮质包边 */}
      <mesh position={[0, TABLE_Y + 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} material={railMat} castShadow receiveShadow>
        <torusGeometry args={[TABLE_R + 0.2, 0.2, 24, 128]} />
      </mesh>
      {/* 杯架 */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * (TABLE_R + 0.2), TABLE_Y + 0.235, Math.cos(a) * (TABLE_R + 0.2)]}>
            <mesh geometry={GEO.torusThin} material={chrome()} rotation={[Math.PI / 2, 0, 0]} scale={[0.085, 0.085, 0.6]} />
            <mesh position={[0, -0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.08, 20]} />
              <meshStandardMaterial color="#0c0c0e" roughness={0.6} />
            </mesh>
          </group>
        );
      })}
      {/* 漆面木桌裙 */}
      <mesh position={[0, TABLE_Y - 0.2, 0]} castShadow material={apron}>
        <cylinderGeometry args={[TABLE_R + 0.36, TABLE_R + 0.05, 0.34, 128, 1, true]} />
      </mesh>
      <mesh position={[0, TABLE_Y - 0.37, 0]} rotation={[Math.PI / 2, 0, 0]} material={apron}>
        <circleGeometry args={[TABLE_R + 0.05, 64]} />
      </mesh>
      {/* 桌腿底座 */}
      <mesh geometry={GEO.cyl} material={apron} position={[0, 0.32, 0]} scale={[0.55, 0.64, 0.55]} castShadow />
      <mesh geometry={GEO.cyl} material={apron} position={[0, 0.05, 0]} scale={[1.7, 0.1, 1.7]} castShadow receiveShadow />
      <mesh geometry={GEO.torusThin} material={brass()} position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.7, 1.7, 1]} />
    </group>
  );
}

/** 座椅：皮质坐垫与靠背 + 木质框架 + 金属底座 */
export function Chair({ position, rotY, color }: { position: [number, number, number]; rotY: number; color?: string }) {
  const theme = useSettings((s) => s.room);
  const m = leather(color ?? THEME[theme].chair);
  const frame = lacqueredWood('chairframe', '#3a1e10', [1, 1]);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh geometry={GEO.cyl} material={m} position={[0, 0.5, 0]} scale={[0.64, 0.16, 0.64]} castShadow receiveShadow />
      <mesh geometry={GEO.torus} material={frame} position={[0, 0.43, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.64, 0.64, 0.5]} />
      <mesh geometry={GEO.box} material={m} position={[0, 1.18, -0.56]} scale={[1.05, 1.2, 0.16]} castShadow />
      <mesh geometry={GEO.box} material={frame} position={[0, 1.8, -0.56]} scale={[1.12, 0.08, 0.2]} />
      <mesh geometry={GEO.cyl} material={chrome()} position={[0, 0.22, 0]} scale={[0.05, 0.46, 0.05]} />
      <mesh geometry={GEO.cyl} material={blackMetal()} position={[0, 0.02, 0]} scale={[0.42, 0.04, 0.42]} receiveShadow />
    </group>
  );
}
