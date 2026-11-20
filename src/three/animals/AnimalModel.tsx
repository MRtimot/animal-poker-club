import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AnimalConfig, EYE_COLORS, FUR_COLORS, SPECIES_MAP } from '../../core/player/profile';
import { GEO, GOLD, mat, shade } from './materials';
import { LOOKS, TailType } from './species';
import { animatePose, basePose } from '../../animation/animalAnimations';
import { AnimName, useFx } from '../../store/fxStore';
import { damp, ease } from '../../animation/motion';

type V3 = [number, number, number];
type GeoKey = keyof typeof GEO;

function M({ g = 'sphere', c, p, s, r, m, cast }: { g?: GeoKey; c: string; p?: V3; s?: V3 | number; r?: V3; m?: Parameters<typeof mat>[1]; cast?: boolean }) {
  const scale = typeof s === 'number' ? ([s, s, s] as V3) : s;
  return <mesh geometry={GEO[g]} material={mat(c, m)} position={p} scale={scale} rotation={r} castShadow={cast} />;
}

// ───────────── 尾巴几何体（缓存） ─────────────
const tailGeoCache = new Map<string, THREE.TubeGeometry>();
function tubeGeo(key: string, pts: V3[], radius: number) {
  let g = tailGeoCache.get(key);
  if (!g) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    g = new THREE.TubeGeometry(curve, 24, radius, 8, false);
    tailGeoCache.set(key, g);
  }
  return g;
}

function Tail({ type, fur, inner, look }: { type: TailType; fur: string; inner: string; look: string }) {
  switch (type) {
    case 'cat':
      return (
        <>
          <mesh geometry={tubeGeo('cat', [[0, 0, 0], [0, 0.05, -0.25], [0, 0.4, -0.38], [0, 0.72, -0.25]], 0.055)} material={mat(fur, { rough: 0.85 })} />
          <M c={look === 'tiger' ? '#2a1a12' : fur} p={[0, 0.72, -0.25]} s={0.06} />
        </>
      );
    case 'dog':
      return <mesh geometry={tubeGeo('dog', [[0, 0, 0], [0, 0.15, -0.22], [0, 0.42, -0.25]], 0.065)} material={mat(fur, { rough: 0.85 })} />;
    case 'bushy':
      return (
        <>
          <M c={fur} p={[0, 0.22, -0.28]} s={[0.15, 0.16, 0.38]} r={[-0.8, 0, 0]} m={{ rough: 0.9 }} />
          <M c={look === 'fox' ? '#fff6ea' : shade(fur, 1.25)} p={[0, 0.5, -0.5]} s={[0.1, 0.12, 0.13]} r={[-0.8, 0, 0]} />
        </>
      );
    case 'ringed':
      return (
        <group rotation={[-0.8, 0, 0]} position={[0, 0.22, -0.28]}>
          <M c={fur} s={[0.14, 0.14, 0.4]} m={{ rough: 0.9 }} />
          {[-0.18, 0, 0.18].map((z) => (
            <M key={z} g="torus" c="#2b2b30" p={[0, 0, z]} s={[0.13, 0.13, 0.25]} />
          ))}
        </group>
      );
    case 'puff':
      return <M c="#ffffff" p={[0, 0.05, -0.02]} s={0.13} m={{ rough: 1 }} />;
    case 'short':
      return <M c={fur} p={[0, 0.05, -0.02]} s={0.09} />;
    case 'curl':
      return <mesh geometry={tubeGeo('curl', [[0, 0, 0], [0, 0.1, -0.3], [0, 0.45, -0.4], [0, 0.6, -0.2], [0, 0.45, -0.1], [0, 0.4, -0.25]], 0.045)} material={mat(fur)} />;
    case 'tuft':
      return (
        <>
          <mesh geometry={tubeGeo('tuft', [[0, 0, 0], [0, 0.05, -0.3], [0, 0.3, -0.5], [0, 0.55, -0.45]], 0.04)} material={mat(fur)} />
          <M c="#8a4a1a" p={[0, 0.56, -0.45]} s={0.09} m={{ rough: 1 }} />
        </>
      );
    case 'dragon':
      return (
        <group position={[0, 0.05, -0.05]} rotation={[-1.25, 0, 0]}>
          <M g="cone" c={fur} p={[0, -0.4, 0]} s={[0.15, 0.8, 0.15]} r={[Math.PI, 0, 0]} />
          {[0.1, 0.3, 0.5].map((y) => (
            <M key={y} g="cone" c={inner} p={[0, -y - 0.1, -0.08 + y * 0.1]} s={[0.04, 0.1, 0.04]} r={[-1.6, 0, 0]} />
          ))}
        </group>
      );
    case 'penguin':
      return <M g="cone" c={fur} p={[0, 0.05, -0.05]} s={[0.12, 0.18, 0.05]} r={[-2.2, 0, 0]} />;
    default:
      return null;
  }
}

// ───────────── 头部配件 ─────────────

function Hat({ hat, color }: { hat: AnimalConfig['hat']; color: string }) {
  switch (hat) {
    case 'tophat':
      return (
        <group position={[0, 0.36, -0.02]} rotation={[-0.08, 0, 0.08]}>
          <M g="cyl" c="#16161c" p={[0, 0.02, 0]} s={[0.36, 0.025, 0.36]} m={{ rough: 0.4 }} />
          <M g="cyl" c="#16161c" p={[0, 0.2, 0]} s={[0.22, 0.34, 0.22]} m={{ rough: 0.4 }} cast />
          <M g="cyl" c="#c0392b" p={[0, 0.07, 0]} s={[0.225, 0.06, 0.225]} />
        </group>
      );
    case 'crown':
      return (
        <group position={[0, 0.4, 0]}>
          <M g="cylOpen" c="#f2c230" p={[0, 0.05, 0]} s={[0.23, 0.14, 0.23]} m={GOLD} />
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            return <M key={i} g="cone" c="#f2c230" p={[Math.sin(a) * 0.21, 0.17, Math.cos(a) * 0.21]} s={[0.05, 0.12, 0.05]} m={GOLD} />;
          })}
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2 + 0.6;
            return <M key={'g' + i} c={['#e74c3c', '#3498db', '#2ecc71'][i % 3]} p={[Math.sin(a) * 0.235, 0.05, Math.cos(a) * 0.235]} s={0.03} m={{ rough: 0.1, metal: 0.3 }} />;
          })}
        </group>
      );
    case 'cap':
      return (
        <group position={[0, 0.2, 0]} rotation={[-0.15, 0, 0]}>
          <M g="halfSphere" c={color} s={[0.42, 0.32, 0.42]} />
          <M g="cyl" c={shade(color, 0.8)} p={[0, 0.02, 0.36]} s={[0.26, 0.02, 0.2]} />
          <M c={shade(color, 0.7)} p={[0, 0.32, 0]} s={0.04} />
        </group>
      );
    case 'cowboy':
      return (
        <group position={[0, 0.34, 0]} rotation={[-0.1, 0, -0.06]}>
          <M g="cyl" c="#8b5a2b" s={[0.58, 0.025, 0.5]} />
          <M g="cyl" c="#8b5a2b" p={[0, 0.14, 0]} s={[0.25, 0.26, 0.22]} cast />
          <M g="cyl" c="#3a2210" p={[0, 0.05, 0]} s={[0.255, 0.05, 0.225]} />
        </group>
      );
    case 'grad':
      return (
        <group position={[0, 0.38, 0]}>
          <M g="cyl" c="#1b1b22" p={[0, 0.02, 0]} s={[0.27, 0.12, 0.27]} />
          <M g="box" c="#1b1b22" p={[0, 0.1, 0]} s={[0.62, 0.03, 0.62]} r={[0, Math.PI / 4, 0]} cast />
          <M g="cyl" c="#f2c230" p={[0.3, 0.0, 0]} s={[0.01, 0.2, 0.01]} />
          <M c="#f2c230" p={[0.3, -0.1, 0]} s={0.03} />
          <M c="#f2c230" p={[0, 0.125, 0]} s={0.03} />
        </group>
      );
    case 'santa':
      return (
        <group position={[0, 0.36, 0]} rotation={[0, 0, -0.3]}>
          <M g="cone" c="#d62828" p={[0, 0.25, 0]} s={[0.29, 0.5, 0.29]} cast />
          <M g="torus" c="#ffffff" p={[0, 0.02, 0]} s={[0.29, 0.29, 0.6]} r={[Math.PI / 2, 0, 0]} m={{ rough: 1 }} />
          <M c="#ffffff" p={[0, 0.52, 0]} s={0.07} m={{ rough: 1 }} />
        </group>
      );
    default:
      return null;
  }
}

function Glasses({ type, eyeY, eyeX }: { type: AnimalConfig['glasses']; eyeY: number; eyeX: number }) {
  const z = 0.47;
  switch (type) {
    case 'shades':
      return (
        <group position={[0, eyeY, 0]}>
          {[eyeX, -eyeX].map((x) => (
            <M key={x} g="cyl" c="#0b0b10" p={[x, 0, z]} s={[0.11, 0.02, 0.085]} r={[Math.PI / 2, 0, 0]} m={{ rough: 0.1, metal: 0.6 }} />
          ))}
          <M g="box" c="#0b0b10" p={[0, 0.02, z]} s={[0.1, 0.02, 0.02]} />
          {[1, -1].map((sx) => (
            <M key={sx} g="box" c="#0b0b10" p={[sx * 0.3, 0.02, 0.26]} s={[0.02, 0.02, 0.36]} r={[0, sx * 0.45, 0]} />
          ))}
        </group>
      );
    case 'round':
    case 'gold': {
      const c = type === 'gold' ? '#e0b030' : '#5a3a22';
      const opts = type === 'gold' ? GOLD : { rough: 0.5 };
      return (
        <group position={[0, eyeY, 0]}>
          {[eyeX, -eyeX].map((x) => (
            <group key={x}>
              <M g="torus" c={c} p={[x, 0, z]} s={[0.095, 0.095, 0.2]} m={opts} />
              {type === 'gold' && <M g="cyl" c="#ffcc66" p={[x, 0, z - 0.005]} s={[0.09, 0.005, 0.09]} r={[Math.PI / 2, 0, 0]} m={{ opacity: 0.35, rough: 0.1 }} />}
            </group>
          ))}
          <M g="box" c={c} p={[0, 0.02, z]} s={[0.08, 0.015, 0.015]} m={opts} />
        </group>
      );
    }
    case 'science':
      return (
        <group position={[0, eyeY, 0]}>
          {[eyeX, -eyeX].map((x) => (
            <group key={x}>
              <M g="cyl" c="#d8dde3" p={[x, 0, z - 0.02]} s={[0.11, 0.08, 0.11]} r={[Math.PI / 2, 0, 0]} m={{ rough: 0.3 }} />
              <M g="cyl" c="#7fd4ff" p={[x, 0, z + 0.025]} s={[0.09, 0.01, 0.09]} r={[Math.PI / 2, 0, 0]} m={{ opacity: 0.55, rough: 0.05, emissive: '#7fd4ff', ei: 0.2 }} />
            </group>
          ))}
          <M g="torus" c="#2d6a4f" p={[0, 0, 0]} s={[0.45, 0.45, 0.35]} r={[Math.PI / 2, 0, 0]} />
        </group>
      );
    case 'funny':
      return (
        <group position={[0, eyeY, 0]}>
          {[eyeX, -eyeX].map((x, i) => (
            <M key={x} g="torus" c={i ? '#ff4fa3' : '#4fc3ff'} p={[x, 0, z]} s={[0.12, 0.12, 0.35]} />
          ))}
          <M c="#f5b48a" p={[0, -0.1, z + 0.05]} s={[0.07, 0.08, 0.07]} />
          <M c="#2a1a12" p={[0.06, -0.17, z + 0.02]} s={[0.07, 0.025, 0.03]} r={[0, 0, -0.3]} />
          <M c="#2a1a12" p={[-0.06, -0.17, z + 0.02]} s={[0.07, 0.025, 0.03]} r={[0, 0, 0.3]} />
          <M g="box" c="#2a1a12" p={[eyeX, 0.14, z - 0.02]} s={[0.15, 0.04, 0.03]} />
          <M g="box" c="#2a1a12" p={[-eyeX, 0.14, z - 0.02]} s={[0.15, 0.04, 0.03]} />
        </group>
      );
    default:
      return null;
  }
}

// ───────────── 服装 ─────────────

function Outfit({ outfit, color }: { outfit: AnimalConfig['outfit']; color: string }) {
  const torso: V3 = [0.515, 0.575, 0.455];
  const ty = 0.55;
  const overlay = (c: string, m?: Parameters<typeof mat>[1]) => <M c={c} p={[0, ty, 0]} s={torso} m={m ?? { rough: 0.8 }} cast />;
  switch (outfit) {
    case 'tshirt':
      return (
        <>
          {overlay(color)}
          <M g="torus" c={shade(color, 0.8)} p={[0, 1.0, 0.02]} s={[0.22, 0.22, 0.5]} r={[Math.PI / 2, 0, 0]} />
          <M g="box" c={shade(color, 0.85)} p={[0.2, 0.75, 0.42]} s={[0.12, 0.1, 0.02]} />
          <M c="#ffffff" p={[0, 0.6, 0.45]} s={[0.07, 0.06, 0.01]} />
        </>
      );
    case 'suit':
      return (
        <>
          {overlay('#2a2a36', { rough: 0.6 })}
          <M c="#ffffff" p={[0, 0.74, 0.33]} s={[0.15, 0.26, 0.12]} />
          <M g="box" c={color} p={[0, 0.66, 0.45]} s={[0.06, 0.26, 0.02]} r={[-0.25, 0, 0]} />
          <M g="box" c={shade(color, 0.8)} p={[0, 0.82, 0.43]} s={[0.07, 0.06, 0.03]} />
          {[1, -1].map((s) => (
            <M key={s} g="box" c="#1c1c26" p={[s * 0.11, 0.76, 0.42]} s={[0.05, 0.3, 0.02]} r={[-0.2, 0, s * 0.35]} />
          ))}
          {[0.48, 0.36].map((y) => (
            <M key={y} c="#d4af37" p={[0.08, y, 0.43]} s={0.022} m={GOLD} />
          ))}
        </>
      );
    case 'hoodie':
      return (
        <>
          {overlay(color, { rough: 0.95 })}
          <M g="torus" c={shade(color, 0.9)} p={[0, 0.98, -0.12]} s={[0.3, 0.3, 0.8]} r={[1.25, 0, 0]} m={{ rough: 0.95 }} />
          <M g="box" c={shade(color, 0.85)} p={[0, 0.36, 0.42]} s={[0.36, 0.16, 0.05]} />
          {[1, -1].map((s) => (
            <M key={s} g="cyl" c="#ffffff" p={[s * 0.07, 0.8, 0.43]} s={[0.01, 0.18, 0.01]} />
          ))}
        </>
      );
    case 'denim':
      return (
        <>
          {overlay('#4a78b8', { rough: 0.9 })}
          <M g="box" c="#f4f1ea" p={[0, 0.62, 0.43]} s={[0.14, 0.52, 0.03]} />
          {[1, -1].map((s) => (
            <M key={s} g="box" c="#3a64a0" p={[s * 0.14, 0.92, 0.32]} s={[0.12, 0.14, 0.04]} r={[-0.5, 0, s * 0.5]} />
          ))}
          {[0.75, 0.6, 0.45].map((y) => (
            <M key={y} c="#d4af37" p={[0.1, y, 0.44]} s={0.02} m={GOLD} />
          ))}
        </>
      );
    case 'gown':
      return (
        <>
          {overlay(color, { rough: 0.3, metal: 0.25 })}
          <M g="cone" c={color} p={[0, 0.3, 0]} s={[0.78, 0.62, 0.72]} m={{ rough: 0.3, metal: 0.25 }} cast />
          <M g="torusThin" c="#ffffff" p={[0, 0.96, 0.02]} s={[0.26, 0.26, 0.5]} r={[Math.PI / 2 - 0.2, 0, 0]} m={{ rough: 0.2 }} />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const a = -0.9 + i * 0.3;
            return <M key={i} c="#fffdf0" p={[Math.sin(a) * 0.27, 0.92 - Math.cos(a) * 0.06, 0.06 + Math.cos(a) * 0.22]} s={0.03} m={{ rough: 0.15 }} />;
          })}
        </>
      );
    case 'police':
      return (
        <>
          {overlay('#24406e', { rough: 0.7 })}
          <M g="cyl" c="#e8c25a" p={[0.2, 0.78, 0.4]} s={[0.055, 0.015, 0.065]} r={[Math.PI / 2 - 0.35, 0, 0]} m={GOLD} />
          <M g="torus" c="#111" p={[0, 0.32, 0]} s={[0.5, 0.45, 0.5]} r={[Math.PI / 2, 0, 0]} />
          <M g="box" c="#c9a227" p={[0, 0.32, 0.44]} s={[0.1, 0.07, 0.03]} m={GOLD} />
          <M g="box" c="#111" p={[0, 0.7, 0.45]} s={[0.05, 0.22, 0.02]} r={[-0.25, 0, 0]} />
          {[1, -1].map((s) => (
            <M key={s} g="box" c="#1a3157" p={[s * 0.32, 0.95, 0.05]} s={[0.18, 0.04, 0.14]} />
          ))}
        </>
      );
    case 'chef':
      return (
        <>
          {overlay('#fafafa', { rough: 0.9 })}
          {[0.75, 0.6, 0.45].flatMap((y) => [0.08, -0.08].map((x) => <M key={`${x}${y}`} c="#333" p={[x, y, 0.44]} s={0.022} />))}
          <M g="torus" c="#e63946" p={[0, 0.97, 0.03]} s={[0.24, 0.24, 0.6]} r={[Math.PI / 2 - 0.25, 0, 0]} />
          <M g="cone" c="#e63946" p={[0, 0.85, 0.38]} s={[0.08, 0.12, 0.03]} r={[Math.PI, 0, 0]} />
        </>
      );
    case 'racer':
      return (
        <>
          {overlay(color, { rough: 0.45 })}
          {[0.1, -0.1].map((x) => (
            <M key={x} g="box" c="#ffffff" p={[x, 0.55, 0.42]} s={[0.05, 0.85, 0.04]} r={[0.06, 0, 0]} />
          ))}
          <M g="torus" c="#111" p={[0, 1.0, 0.02]} s={[0.21, 0.21, 0.7]} r={[Math.PI / 2, 0, 0]} />
          <M g="box" c="#ffffff" p={[-0.25, 0.72, 0.38]} s={[0.12, 0.08, 0.02]} r={[0, -0.5, 0]} />
          <M g="box" c="#111" p={[-0.25, 0.72, 0.385]} s={[0.07, 0.04, 0.02]} r={[0, -0.5, 0]} />
        </>
      );
    default:
      return null;
  }
}

function Accessory({ type, color }: { type: AnimalConfig['accessory']; color: string }) {
  switch (type) {
    case 'necklace':
      return (
        <group position={[0, 0.97, 0.02]}>
          {Array.from({ length: 11 }, (_, i) => {
            const a = -1.3 + i * 0.26;
            return <M key={i} c="#fffdf0" p={[Math.sin(a) * 0.28, -Math.cos(a) * 0.08, Math.cos(a) * 0.24]} s={0.035} m={{ rough: 0.15 }} />;
          })}
        </group>
      );
    case 'goldchain':
      return (
        <group position={[0, 0.94, 0.04]} rotation={[0.35, 0, 0]}>
          <M g="torus" c="#e8b923" s={[0.3, 0.3, 0.6]} r={[Math.PI / 2, 0, 0]} m={GOLD} />
          <M g="cyl" c="#e8b923" p={[0, -0.12, 0.3]} s={[0.07, 0.02, 0.07]} r={[Math.PI / 2 - 0.3, 0, 0]} m={GOLD} />
        </group>
      );
    case 'bowtie':
      return (
        <group position={[0, 0.95, 0.38]}>
          <M g="cone" c={color} p={[0.07, 0, 0]} s={[0.06, 0.12, 0.04]} r={[0, 0, Math.PI / 2]} />
          <M g="cone" c={color} p={[-0.07, 0, 0]} s={[0.06, 0.12, 0.04]} r={[0, 0, -Math.PI / 2]} />
          <M c={shade(color, 0.75)} s={0.035} />
        </group>
      );
    case 'tie':
      return (
        <group position={[0, 0.9, 0.42]}>
          <M c={color} s={[0.045, 0.04, 0.03]} />
          <M g="box" c={color} p={[0, -0.18, 0.02]} s={[0.07, 0.3, 0.02]} r={[-0.2, 0, 0]} />
        </group>
      );
    case 'backpack':
      return (
        <group>
          <M g="box" c={shade(color, 0.8)} p={[0, 0.6, -0.5]} s={[0.45, 0.5, 0.2]} cast />
          <M g="box" c={shade(color, 0.65)} p={[0, 0.5, -0.61]} s={[0.3, 0.2, 0.05]} />
          {[1, -1].map((s) => (
            <M key={s} g="box" c={shade(color, 0.65)} p={[s * 0.25, 0.85, 0]} s={[0.06, 0.04, 0.9]} r={[0.15, 0, 0]} />
          ))}
        </group>
      );
    default:
      return null;
  }
}

function HeadAccessory({ type }: { type: AnimalConfig['accessory'] }) {
  if (type === 'headphones')
    return (
      <group>
        <M g="halfTorus" c="#222" s={[0.48, 0.48, 0.5]} m={{ rough: 0.3 }} />
        {[1, -1].map((s) => (
          <M key={s} g="cyl" c="#e84a5f" p={[s * 0.46, 0, 0]} s={[0.12, 0.08, 0.12]} r={[0, 0, Math.PI / 2]} m={{ rough: 0.3 }} />
        ))}
      </group>
    );
  if (type === 'crown')
    return (
      <group position={[0.16, 0.4, 0.02]} rotation={[0, 0, -0.35]} scale={0.55}>
        <M g="cylOpen" c="#f2c230" p={[0, 0.05, 0]} s={[0.23, 0.14, 0.23]} m={GOLD} />
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return <M key={i} g="cone" c="#f2c230" p={[Math.sin(a) * 0.21, 0.17, Math.cos(a) * 0.21]} s={[0.05, 0.12, 0.05]} m={GOLD} />;
        })}
      </group>
    );
  return null;
}

// ───────────── 主模型 ─────────────

export interface AnimalModelProps {
  config: AnimalConfig;
  /** 从特效状态中读取动画的 key（通常是玩家 id） */
  animKey?: string;
  /** 直接指定的一次性动画（展示用） */
  anim?: { name: AnimName; start: number } | null;
  seated?: boolean;
  folded?: boolean;
  thinking?: boolean;
  seed?: number;
  /** 头部看向的方向（相对身体的偏航角），例如正在行动的玩家 */
  lookYaw?: number | null;
}

export const AnimalModel = memo(function AnimalModel({ config, animKey, anim, seated = false, folded = false, thinking = false, seed = 0, lookYaw = null }: AnimalModelProps) {
  const look = LOOKS[config.species];
  const sp = SPECIES_MAP[config.species];
  const furHex = FUR_COLORS.find((f) => f.id === config.furColor)?.hex || sp.color;
  const fur = furHex;
  const inner = look.inner;
  const muzzle = look.muzzle ?? shade(fur, 1.35);
  const limbs = look.limbs ?? fur;
  const eyeHex = EYE_COLORS.find((e) => e.id === config.eyeColor)?.hex ?? '#1a1a1f';
  const es = config.eyeSize;
  const f = look.features;
  const outfitColor = config.outfitColor;
  const sleeves = ['suit', 'hoodie', 'denim', 'police', 'chef', 'racer'].includes(config.outfit);
  const sleeveColor =
    config.outfit === 'suit' ? '#2a2a36' : config.outfit === 'denim' ? '#4a78b8' : config.outfit === 'police' ? '#24406e' : config.outfit === 'chef' ? '#fafafa' : outfitColor;

  const headScale: V3 = useMemo(() => {
    switch (config.face) {
      case 'wide':
        return [1.14, 0.95, 1];
      case 'long':
        return [0.92, 1.12, 1];
      case 'chubby':
        return [1.1, 1, 1.06];
      default:
        return [1, 1, 1];
    }
  }, [config.face]);

  const root = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const tail = useRef<THREE.Group>(null!);
  const mouthOpen = useRef<THREE.Mesh>(null!);
  const eyesNormal = useRef<THREE.Group>(null!);
  const eyesHappy = useRef<THREE.Group>(null!);
  const eyesX = useRef<THREE.Group>(null!);
  const browL = useRef<THREE.Mesh>(null!);
  const browR = useRef<THREE.Mesh>(null!);
  const wingL = useRef<THREE.Group>(null!);
  const wingR = useRef<THREE.Group>(null!);
  const coolGlasses = useRef<THREE.Group>(null!);
  const earsRef = useRef<THREE.Group>(null!);
  const hatRef = useRef<THREE.Group>(null!);
  const lookCur = useRef(0);
  const lookRef = useRef(lookYaw);
  lookRef.current = lookYaw;
  // 换帽子：帽子从上方落到头上
  const hatDrop = useRef(-10);
  const firstHat = useRef(true);
  useEffect(() => {
    if (firstHat.current) {
      firstHat.current = false;
      return;
    }
    hatDrop.current = performance.now();
  }, [config.hat]);

  const frog = !!f.frog;
  const eyeX = frog ? 0.19 : 0.155;
  const eyeY = frog ? 0.33 : 0.05;
  const eyeZ = frog ? 0.26 : 0.37;

  const baseBrow = config.eyebrows;
  const browRot = baseBrow === 'angry' ? 0.4 : baseBrow === 'worried' ? -0.35 : 0;
  const mischief = config.expression === 'mischief';
  const lidAmount = config.expression === 'cool' ? 0.55 : config.expression === 'sleepy' ? 0.95 : 0;
  const baseHappy = config.expression === 'happy';

  useFrame((state, dt) => {
    const time = state.clock.elapsedTime;
    let a = anim ?? null;
    if (animKey) a = useFx.getState().anims[animKey] ?? a;
    let pose = basePose(time, seed, seated, folded, thinking, config.species);
    if (a) pose = animatePose(pose, a.name, performance.now() / 1000 - a.start, seated);
    // 情绪系统：没有一次性动画改变脸部时，显示当前情绪
    const nowMs = performance.now();
    const mood = animKey ? useFx.getState().moods[animKey] : undefined;
    if (mood && mood.until > nowMs && pose.face === 'normal') {
      const w = Math.min(1, (nowMs - mood.start) / 200) * Math.min(1, (mood.until - nowMs) / 300);
      if (w > 0.4) pose.face = mood.face;
      if (mood.face === 'smug') pose.lean -= 0.08 * w;
      if (mood.face === 'wide') pose.lean -= 0.1 * w;
      if (mood.face === 'sad') pose.headX += 0.25 * w;
    }
    // 看向正在行动的玩家（平滑转头）
    const lt = lookRef.current == null || folded ? 0 : Math.max(-0.75, Math.min(0.75, lookRef.current));
    lookCur.current = damp(lookCur.current, lt, 3.2, dt);
    pose.headY += lookCur.current;
    if (earsRef.current) {
      earsRef.current.rotation.x = -pose.ear * 0.2;
      earsRef.current.scale.y = 1 + pose.ear * 0.08;
    }
    if (hatRef.current) {
      const ht = (nowMs - hatDrop.current) / 650;
      if (ht >= 0 && ht < 1) {
        hatRef.current.position.y = (1 - ease.outBounce(ht)) * 0.9;
        hatRef.current.rotation.y = (1 - ease.outCubic(ht)) * Math.PI * 2;
      } else {
        hatRef.current.position.y = 0;
        hatRef.current.rotation.y = 0;
      }
    }

    root.current.position.y = pose.y;
    root.current.rotation.set(pose.lean, pose.turn, pose.roll);
    body.current.scale.set(1 + (1 - pose.squash) * 0.5, pose.squash, 1 + (1 - pose.squash) * 0.5);
    head.current.rotation.set(pose.headX, pose.headY, pose.headZ);
    armL.current.rotation.set(pose.armLX, 0, pose.armLZ);
    armR.current.rotation.set(pose.armRX, 0, pose.armRZ);
    if (tail.current) tail.current.rotation.set(0, pose.tail * 0.6, pose.tail * 0.25);
    const mo = Math.max(0, pose.mouth);
    mouthOpen.current.visible = mo > 0.05;
    mouthOpen.current.scale.set(0.075 + mo * 0.02, 0.02 + mo * 0.07, 0.04);

    const face = pose.face;
    const happy = face === 'happy' || (baseHappy && face === 'normal');
    const smug = face === 'smug';
    const doubt = face === 'doubt';
    eyesHappy.current.visible = happy;
    eyesX.current.visible = face === 'x';
    eyesNormal.current.visible = !happy && face !== 'x';
    const open = face === 'wide' ? Math.max(pose.eyeOpen, 1.25) : pose.eyeOpen;
    eyesNormal.current.scale.set(face === 'wide' ? 1.15 : 1, Math.max(0.08, smug ? Math.min(open, 0.5) : doubt ? Math.min(open, 0.8) : open), 1);

    const br = face === 'angry' ? 0.45 : face === 'sad' ? -0.4 : smug ? 0.12 : browRot;
    const showBrow = baseBrow !== 'none' || face === 'angry' || face === 'sad' || smug || doubt;
    browL.current.visible = browR.current.visible = showBrow;
    // 怀疑：一边眉毛挑起，另一边压低
    browL.current.rotation.z = doubt ? -0.35 : br;
    browR.current.rotation.z = doubt ? -0.4 : -br;
    const by = eyeY + 0.12 * es + (face === 'wide' ? 0.04 : 0) + (smug ? -0.02 : 0);
    browL.current.position.y = by + (doubt ? 0.05 : 0);
    browR.current.position.y = by - (doubt ? 0.01 : 0);

    if (wingL.current) {
      wingL.current.rotation.y = 0.5 + pose.wing;
      wingR.current.rotation.y = -0.5 - pose.wing;
    }
    if (coolGlasses.current && animKey) {
      const until = useFx.getState().coolUntil[animKey] ?? 0;
      coolGlasses.current.visible = Date.now() < until;
    }
  });

  const standOffset = seated ? 0 : 0.42;
  const earStyle = config.ears;
  let earType = look.ear;
  if (earStyle === 'round') earType = 'round';
  else if (earStyle === 'pointy') earType = 'pointy';
  else if ((earStyle === 'normal' || earStyle === 'big') && earType === 'none') earType = 'small';
  const earScale = earStyle === 'big' ? 1.45 : 1;
  const earColor = f.panda ? '#1f1f24' : fur;

  const eyes = (
    <>
      <group ref={eyesNormal} position={[0, eyeY, 0]}>
        {[eyeX, -eyeX].map((x, i) => (
          <group key={x} position={[x, 0, eyeZ]}>
            <M c="#ffffff" s={0.085 * es} m={{ rough: 0.2 }} />
            <M c={eyeHex} p={[0, 0, 0.045 * es]} s={[0.06 * es, 0.065 * es, 0.05 * es]} m={{ rough: 0.15 }} />
            <M c="#050505" p={[0, 0, 0.075 * es]} s={[0.033 * es, 0.036 * es, 0.03 * es]} m={{ rough: 0.1 }} />
            <M c="#ffffff" p={[0.022 * es, 0.025 * es, 0.095 * es]} s={0.014 * es} m={{ emissive: '#ffffff', ei: 0.6 }} />
            {(lidAmount > 0 || (mischief && i === 0)) && (
              <M g="halfSphere" c={frog ? fur : shade(fur, 0.95)} s={0.093 * es} r={[mischief ? 0.6 : lidAmount, 0, 0]} />
            )}
          </group>
        ))}
      </group>
      <group ref={eyesHappy} position={[0, eyeY, 0]} visible={false}>
        {[eyeX, -eyeX].map((x) => (
          <M key={x} g="arc" c="#1a1a1f" p={[x, -0.01, eyeZ + 0.06]} s={[0.055 * es, 0.055 * es, 0.08]} />
        ))}
      </group>
      <group ref={eyesX} position={[0, eyeY, 0]} visible={false}>
        {[eyeX, -eyeX].flatMap((x) =>
          [0.78, -0.78].map((r) => <M key={`${x}${r}`} g="box" c="#1a1a1f" p={[x, 0, eyeZ + 0.06]} s={[0.13, 0.025, 0.02]} r={[0, 0, r]} />),
        )}
      </group>
      <mesh ref={browL} geometry={GEO.box} material={mat('#2a1d18')} position={[eyeX, eyeY + 0.12, eyeZ + 0.04]} scale={[0.13, baseBrow === 'thick' ? 0.045 : 0.022, 0.02]} />
      <mesh ref={browR} geometry={GEO.box} material={mat('#2a1d18')} position={[-eyeX, eyeY + 0.12, eyeZ + 0.04]} scale={[0.13, baseBrow === 'thick' ? 0.045 : 0.022, 0.02]} />
    </>
  );

  // 嘴部
  const mouthY = frog ? -0.08 : f.penguin ? -0.16 : -0.18;
  const mouthZ = look.snout === 'long' || look.snout === 'dragon' ? 0.52 : frog ? 0.42 : 0.47;
  const mouth = (
    <group position={[0, mouthY, mouthZ]}>
      {config.mouth === 'smile' && <M g="halfTorus" c="#2a1414" s={[frog ? 0.16 : 0.055, frog ? 0.09 : 0.05, 0.4]} r={[0, 0, Math.PI]} />}
      {config.mouth === 'grin' && (
        <>
          <M g="halfSphere" c="#3a1010" s={[0.08, 0.06, 0.03]} r={[Math.PI, 0, 0]} />
          <M g="box" c="#ffffff" p={[0, -0.008, 0.012]} s={[0.12, 0.018, 0.02]} />
        </>
      )}
      {config.mouth === 'flat' && <M g="box" c="#2a1414" s={[0.09, 0.012, 0.02]} />}
      {(config.mouth === 'open' || config.mouth === 'tongue') && <M c="#3a1010" s={[0.06, 0.045, 0.03]} />}
      {config.mouth === 'tongue' && <M c="#ff7a9a" p={[0.015, -0.04, 0.02]} s={[0.035, 0.04, 0.02]} />}
      <mesh ref={mouthOpen} geometry={GEO.sphere} material={mat('#3a1010')} position={[0, -0.02, 0.005]} visible={false} />
      {f.teeth && <M g="box" c="#ffffff" p={[0, -0.03, 0.01]} s={[0.06, 0.05, 0.015]} />}
    </group>
  );

  const ears = (() => {
    const s = earScale;
    switch (earType) {
      case 'pointy':
        return [1, -1].map((x) => (
          <group key={x} position={[x * 0.27, 0.33, -0.03]} rotation={[0, 0, -x * 0.32]} scale={s}>
            <M g="cone" c={earColor} p={[0, 0.12, 0]} s={[0.13, 0.28, 0.08]} cast />
            <M g="cone" c={inner} p={[0, 0.1, 0.03]} s={[0.08, 0.2, 0.04]} />
            {f.foxTips && <M g="cone" c="#1d1414" p={[0, 0.235, 0]} s={[0.05, 0.07, 0.035]} />}
          </group>
        ));
      case 'round':
        return [1, -1].map((x) => (
          <group key={x} position={[x * 0.3, 0.32, -0.04]} scale={s}>
            <M c={earColor} s={[0.13, 0.13, 0.07]} cast />
            <M c={f.panda ? '#3a3a40' : inner} p={[0, 0, 0.03]} s={[0.08, 0.08, 0.04]} />
          </group>
        ));
      case 'long':
        return [1, -1].map((x) => (
          <group key={x} position={[x * 0.14, 0.4, -0.05]} rotation={[-0.1, 0, -x * 0.12]} scale={s}>
            <M c={earColor} p={[0, 0.24, 0]} s={[0.085, 0.3, 0.055]} cast />
            <M c={inner} p={[0, 0.24, 0.03]} s={[0.05, 0.24, 0.03]} />
          </group>
        ));
      case 'floppy':
        return [1, -1].map((x) => (
          <group key={x} position={[x * 0.38, 0.1, -0.02]} rotation={[0, 0, x * 0.28]} scale={s}>
            <M c={shade(fur, 0.75)} s={[0.1, 0.24, 0.07]} cast />
          </group>
        ));
      case 'koala':
        return [1, -1].map((x) => (
          <group key={x} position={[x * 0.38, 0.28, -0.05]} scale={s}>
            <M c={earColor} s={[0.2, 0.2, 0.09]} m={{ rough: 1 }} cast />
            <M c="#f7f7f9" p={[0, 0, 0.04]} s={[0.13, 0.13, 0.05]} m={{ rough: 1 }} />
          </group>
        ));
      case 'side':
        return [1, -1].map((x) => (
          <group key={x} position={[x * 0.46, 0.02, 0]} scale={s}>
            <M c={earColor} s={[0.06, 0.13, 0.12]} />
            <M c={inner} p={[x * 0.02, 0, 0]} s={[0.04, 0.09, 0.08]} />
          </group>
        ));
      case 'small':
        return [1, -1].map((x) => (
          <M key={x} c={earColor} p={[x * 0.28, 0.32, -0.04]} s={[0.08 * s, 0.08 * s, 0.05 * s]} />
        ));
      default:
        return null;
    }
  })();

  const snout = (() => {
    switch (look.snout) {
      case 'short':
        return (
          <>
            <M c={muzzle} p={[0, -0.1, 0.35]} s={[0.19, 0.13, 0.13]} />
            <M c={look.nose} p={[0, -0.04, 0.47]} s={[0.05, 0.035, 0.035]} m={{ rough: 0.3 }} />
          </>
        );
      case 'long':
        return (
          <>
            <M c={muzzle} p={[0, -0.1, 0.4]} s={[0.15, 0.12, 0.22]} />
            <M c={look.nose} p={[0, -0.03, 0.6]} s={[0.05, 0.04, 0.04]} m={{ rough: 0.3 }} />
          </>
        );
      case 'monkey':
        return (
          <>
            <M c={inner} p={[0, -0.02, 0.27]} s={[0.32, 0.3, 0.18]} />
            <M c={shade(inner, 1.05)} p={[0, -0.13, 0.37]} s={[0.17, 0.11, 0.11]} />
            <M c={look.nose} p={[0, -0.07, 0.46]} s={[0.04, 0.025, 0.02]} />
          </>
        );
      case 'beak':
        return <M g="cone" c="#f5a623" p={[0, -0.06, 0.5]} s={[0.07, 0.18, 0.05]} r={[Math.PI / 2, 0, 0]} m={{ rough: 0.4 }} />;
      case 'dragon':
        return (
          <>
            <M c={fur} p={[0, -0.08, 0.4]} s={[0.2, 0.14, 0.24]} />
            {[1, -1].map((x) => (
              <M key={x} c="#123a2c" p={[x * 0.06, -0.02, 0.62]} s={0.025} />
            ))}
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <group>
      <group ref={root}>
        <group position={[0, standOffset, 0]}>
          {/* 身体 */}
          <group ref={body}>
            <M c={fur} p={[0, 0.55, 0]} s={[0.5, 0.56, 0.44]} m={{ rough: 0.85 }} cast />
            {config.outfit === 'none' && <M c={f.penguin ? '#ffffff' : shade(inner, 1)} p={[0, 0.5, 0.28]} s={[0.33, 0.38, 0.2]} m={{ rough: 0.9 }} />}
            {f.tiger && config.outfit === 'none' && [0.4, 0.6, 0.8].map((y) => <M key={y} g="box" c="#2a1a12" p={[0, y, -0.42]} s={[0.3, 0.03, 0.05]} />)}
            <Outfit outfit={config.outfit} color={outfitColor} />
            <Accessory type={config.accessory} color={outfitColor} />
          </group>

          {/* 腿 */}
          {[1, -1].map((x) =>
            seated ? (
              <M key={x} c={limbs} p={[x * 0.21, 0.12, 0.32]} s={[0.15, 0.13, 0.25]} />
            ) : (
              <group key={x}>
                <M c={limbs} p={[x * 0.2, -0.18, 0.02]} s={[0.15, 0.28, 0.15]} />
                <M c={f.penguin ? '#f5a623' : limbs} p={[x * 0.2, -0.38, 0.08]} s={[0.15, 0.07, 0.2]} />
              </group>
            ),
          )}

          {/* 手臂（肩部为旋转支点） */}
          {[
            { ref: armL, x: 0.42 },
            { ref: armR, x: -0.42 },
          ].map(({ ref, x }) => (
            <group key={x} ref={ref} position={[x, 0.86, 0.04]}>
              {f.penguin ? (
                <M c={fur} p={[0, -0.25, 0]} s={[0.06, 0.3, 0.15]} />
              ) : (
                <>
                  <mesh geometry={GEO.capsule} material={mat(sleeves ? sleeveColor : limbs, { rough: 0.85 })} position={[0, -0.22, 0]} scale={[0.095, 0.16, 0.095]} castShadow />
                  {config.outfit === 'tshirt' && <M c={outfitColor} p={[0, -0.05, 0]} s={[0.12, 0.12, 0.12]} />}
                  <M c={limbs} p={[0, -0.45, 0]} s={0.11} />
                </>
              )}
            </group>
          ))}

          {/* 尾巴 */}
          <group ref={tail} position={[0, 0.28, -0.4]}>
            <Tail type={look.tail} fur={fur} inner={inner} look={config.species} />
          </group>

          {/* 翅膀 */}
          {(config.accessory === 'wings' || f.dragon) && (
            <group position={[0, 0.8, -0.35]}>
              <group ref={wingL} position={[0.12, 0, 0]}>
                <M c={f.dragon ? shade(fur, 0.8) : '#ffffff'} p={[0.25, 0.05, -0.05]} s={[0.32, 0.22, 0.03]} r={[0, 0, 0.4]} m={f.dragon ? { rough: 0.6 } : { emissive: '#ffffff', ei: 0.15, rough: 0.5 }} />
              </group>
              <group ref={wingR} position={[-0.12, 0, 0]}>
                <M c={f.dragon ? shade(fur, 0.8) : '#ffffff'} p={[-0.25, 0.05, -0.05]} s={[0.32, 0.22, 0.03]} r={[0, 0, -0.4]} m={f.dragon ? { rough: 0.6 } : { emissive: '#ffffff', ei: 0.15, rough: 0.5 }} />
              </group>
            </group>
          )}

          {/* 头 */}
          <group ref={head} position={[0, 1.38, 0.02]}>
            <group scale={headScale}>
              <M c={fur} s={[0.44, 0.42, 0.42]} m={{ rough: 0.85 }} cast />
              {f.lion &&
                Array.from({ length: 16 }, (_, i) => {
                  const a = (i / 16) * Math.PI * 2;
                  return <M key={i} c={shade(fur, 0.65)} p={[Math.cos(a) * 0.4, Math.sin(a) * 0.38 + 0.02, -0.08]} s={0.17} m={{ rough: 1 }} />;
                })}
              {f.penguin && <M c="#ffffff" p={[0, -0.04, 0.26]} s={[0.34, 0.3, 0.2]} />}
              {f.panda && [1, -1].map((x) => <M key={x} c="#1f1f24" p={[x * 0.16, 0.03, 0.33]} s={[0.11, 0.13, 0.06]} r={[0, 0, x * 0.5]} />)}
              {f.raccoon && <M c="#2b2b30" p={[0, 0.05, 0.31]} s={[0.36, 0.1, 0.12]} />}
              {f.tiger &&
                [
                  [0, 0.3, 0.3, 0],
                  [0.12, 0.27, 0.3, -0.3],
                  [-0.12, 0.27, 0.3, 0.3],
                  [0.34, -0.03, 0.2, 1.2],
                  [-0.34, -0.03, 0.2, -1.2],
                ].map(([x, y, z, r], i) => <M key={i} g="box" c="#2a1a12" p={[x, y, z]} s={[0.035, 0.13, 0.03]} r={[0, 0, r]} />)}
              {f.frog && (
                <>
                  {[1, -1].map((x) => (
                    <M key={x} c={fur} p={[x * 0.19, 0.3, 0.16]} s={0.15} />
                  ))}
                  <M c={inner} p={[0, -0.16, 0.25]} s={[0.3, 0.16, 0.18]} />
                </>
              )}
              {f.koala && <M c={look.nose} p={[0, -0.06, 0.42]} s={[0.075, 0.1, 0.06]} m={{ rough: 0.3 }} />}
              {f.dragon && (
                <>
                  {[1, -1].map((x) => (
                    <M key={x} g="cone" c={inner} p={[x * 0.17, 0.44, -0.1]} s={[0.055, 0.24, 0.055]} r={[-0.55, 0, -x * 0.2]} m={{ rough: 0.4 }} />
                  ))}
                  {[0, 1, 2].map((i) => (
                    <M key={'s' + i} g="cone" c={inner} p={[0, 0.38 - i * 0.14, -0.36 + i * 0.03]} s={[0.04, 0.1, 0.04]} r={[-1.2 - i * 0.3, 0, 0]} />
                  ))}
                </>
              )}
              {/* 腮红 */}
              {!f.frog && [1, -1].map((x) => <M key={x} c="#ff9fb0" p={[x * 0.26, -0.1, 0.3]} s={[0.07, 0.04, 0.03]} m={{ opacity: 0.6 }} />)}
              {config.face === 'chubby' && [1, -1].map((x) => <M key={'c' + x} c={shade(fur, 1.1)} p={[x * 0.25, -0.13, 0.2]} s={0.15} />)}
              {snout}
              {f.whiskers &&
                [1, -1].flatMap((x) =>
                  [-0.12, 0, 0.12].map((r) => (
                    <M key={`${x}${r}`} g="cyl" c="#ffffff" p={[x * 0.26, -0.09 + r * 0.2, 0.42]} s={[0.006, 0.2, 0.006]} r={[0, 0, Math.PI / 2 + r * x]} />
                  )),
                )}
              {eyes}
              {mouth}
              <group ref={earsRef}>{ears}</group>
              <group ref={hatRef}>
                <Hat hat={config.hat} color={outfitColor} />
              </group>
              <Glasses type={config.glasses} eyeX={eyeX} eyeY={eyeY} />
              {config.glasses !== 'shades' && (
                <group ref={coolGlasses} visible={false}>
                  <Glasses type="shades" eyeX={eyeX} eyeY={eyeY} />
                </group>
              )}
              <HeadAccessory type={config.accessory} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
});
