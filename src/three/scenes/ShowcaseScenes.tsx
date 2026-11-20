import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Html, Lightformer, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { AnimalModel } from '../animals/AnimalModel';
import { AnimalConfig, randomAnimal } from '../../core/player/profile';
import type { LobbyMember } from '../../core/protocol';
import { ClubEnvironment, PokerTableMesh } from '../environment/ClubEnvironment';
import { SceneLights } from './SceneLights';
import { useSettings } from '../../store/settingsStore';
import { AnimName, useFx } from '../../store/fxStore';
import { Bursts } from '../effects/Bursts';
import { ease } from '../../animation/motion';
import { GEO, mat } from '../animals/materials';
import { seededRandom } from '../../core/utils/random';

function Pedestal({ position, color = '#b58a3c', r = 0.9 }: { position: [number, number, number]; color?: string; r?: number }) {
  return (
    <group position={position}>
      <mesh geometry={GEO.cyl} material={mat('#1e130d', { rough: 0.7 })} position={[0, 0.12, 0]} scale={[r, 0.24, r]} castShadow receiveShadow />
      <mesh geometry={GEO.torusThin} material={mat(color, { rough: 0.3, metal: 1 })} position={[0, 0.245, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[r, r, 1]} />
    </group>
  );
}

const SHOW_ANIMS: AnimName[] = ['wave', 'happy', 'laugh', 'cool', 'clap', 'love', 'fire', 'win'];

/** 循环播放展示动画 */
function useCycleAnim(intervalMs: number, offset = 0) {
  const [anim, setAnim] = useState<{ name: AnimName; start: number } | null>(null);
  useEffect(() => {
    let i = offset;
    const t0 = setTimeout(() => setAnim({ name: SHOW_ANIMS[i % SHOW_ANIMS.length], start: performance.now() / 1000 }), 600 + offset * 700);
    const iv = setInterval(() => {
      i++;
      setAnim({ name: SHOW_ANIMS[i % SHOW_ANIMS.length], start: performance.now() / 1000 });
    }, intervalMs);
    return () => {
      clearTimeout(t0);
      clearInterval(iv);
    };
  }, [intervalMs, offset]);
  return anim;
}

function ShowAnimal({ config, position, rotY, offset, scale = 1 }: { config: AnimalConfig; position: [number, number, number]; rotY: number; offset: number; scale?: number }) {
  const anim = useCycleAnim(5200 + offset * 400, offset);
  return (
    <group position={position} rotation={[0, rotY, 0]} scale={scale}>
      <AnimalModel config={config} anim={anim} seed={offset + 1} />
    </group>
  );
}

function DriftCamera({ pos, look, sway = 0.6 }: { pos: [number, number, number]; look: [number, number, number]; sway?: number }) {
  const { camera, size } = useThree();
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const on = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', on);
    return () => window.removeEventListener('pointermove', on);
  }, []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, dt) => {
    const portrait = size.width / size.height < 0.9;
    const t = clock.elapsedTime;
    v.set(
      pos[0] + Math.sin(t * 0.15) * sway + pointer.current.x * 0.5,
      pos[1] + (portrait ? 1.2 : 0) - pointer.current.y * 0.25,
      pos[2] + (portrait ? 4 : 0),
    );
    camera.position.lerp(v, 1 - Math.exp(-2 * dt));
    camera.lookAt(look[0], look[1], look[2]);
  });
  return null;
}

/** 首页：俱乐部中展示玩家的动物与朋友们 */
export function HomeScene({ config }: { config: AnimalConfig }) {
  const quality = useSettings((s) => s.quality);
  const friends = useMemo(() => {
    const rng = seededRandom(20261121);
    const picks = ['fox', 'panda', 'frog', 'lion', 'rabbit', 'penguin'] as const;
    return picks.map((sp) => randomAnimal(rng, [sp]));
  }, []);
  return (
    <>
      <SceneLights quality={quality} />
      <ClubEnvironment quality={quality} />
      <group position={[0, 0, -5]}>
        <PokerTableMesh />
      </group>
      <Pedestal position={[0, 0, 1.8]} r={1.1} />
      <ShowAnimal config={config} position={[0, 0.66, 1.8]} rotY={0} offset={0} scale={1.15} />
      {friends.map((f, i) => {
        const side = i % 2 ? 1 : -1;
        const k = Math.floor(i / 2) + 1;
        const x = side * (1.9 + (k - 1) * 1.7);
        const z = 1.2 - k * 0.9;
        return (
          <group key={i}>
            <Pedestal position={[x, 0, z]} r={0.75} />
            <ShowAnimal config={f} position={[x, 0.66, z]} rotY={-side * 0.35} offset={i + 1} />
          </group>
        );
      })}
      <DriftCamera pos={[0, 2.6, 7.6]} look={[0, 1.55, 0]} />
    </>
  );
}

type Change = { kind: 'species' | 'outfit' | 'random'; start: number };

/**
 * 创建器里的动物：
 * 换动物：缩小旋转 → 粒子 → 新动物弹出；换衣服：转一圈；随机生成：快速旋转 → 突然停住
 */
function CreatorAnimal({ config, anim }: { config: AnimalConfig; anim: { name: AnimName; start: number } | null }) {
  const [shown, setShown] = useState(config);
  const prev = useRef(config);
  const change = useRef<Change | null>(null);
  const g = useRef<THREE.Group>(null!);
  useEffect(() => {
    const a = prev.current;
    prev.current = config;
    const keys = Object.keys(config) as (keyof AnimalConfig)[];
    const diff = keys.filter((k) => a[k] !== config[k]).length;
    const now = performance.now();
    if (diff >= 4) {
      change.current = { kind: 'random', start: now };
      useFx.getState().burst([0, 1.3, 0], 'sparkle');
      const t = setTimeout(() => setShown(config), 380);
      return () => clearTimeout(t);
    }
    if (a.species !== config.species) {
      change.current = { kind: 'species', start: now };
      const t = setTimeout(() => {
        setShown(config);
        useFx.getState().burst([0, 0.9, 0], 'poof');
        useFx.getState().burst([0, 1.4, 0], 'sparkle');
      }, 230);
      return () => clearTimeout(t);
    }
    if (a.outfit !== config.outfit || a.outfitColor !== config.outfitColor) change.current = { kind: 'outfit', start: now };
    setShown(config);
  }, [config]);
  useFrame(() => {
    const c = change.current;
    if (!g.current) return;
    let sc = 1;
    let rot = 0;
    let y = 0;
    if (c) {
      const t = (performance.now() - c.start) / 1000;
      if (c.kind === 'species') {
        if (t < 0.23) {
          const p = t / 0.23;
          sc = 1 - ease.inQuad(p) * 0.95;
          rot = ease.inQuad(p) * Math.PI;
        } else if (t < 0.8) {
          const p = (t - 0.23) / 0.57;
          sc = 0.05 + 0.95 * ease.outBack(p, 2);
          rot = Math.PI + ease.outCubic(p) * Math.PI;
          y = Math.sin(p * Math.PI) * 0.25;
        } else change.current = null;
      } else if (c.kind === 'outfit') {
        if (t < 0.7) rot = ease.inOutCubic(t / 0.7) * Math.PI * 2;
        else change.current = null;
      } else {
        // 随机：快速旋转、身体发光粒子，然后突然停住（轻微回弹）
        if (t < 0.75) {
          rot = Math.PI * 6 * ease.inOutSine(t / 0.75);
          y = Math.sin((t / 0.75) * Math.PI) * 0.35;
          sc = 1 - Math.sin((t / 0.75) * Math.PI) * 0.12;
        } else if (t < 1.1) {
          const p = (t - 0.75) / 0.35;
          rot = Math.sin(p * Math.PI * 2) * 0.18 * (1 - p);
          sc = 1 + Math.sin(p * Math.PI) * 0.06;
        } else change.current = null;
      }
    }
    g.current.scale.setScalar(sc);
    g.current.rotation.y = rot;
    g.current.position.y = 0.36 + y;
  });
  return (
    <group ref={g} position={[0, 0.36, 0]}>
      <AnimalModel config={shown} anim={anim} seed={3} />
    </group>
  );
}

/** 动物创建器：可拖动旋转、滚轮缩放的 360° 实时预览 */
export function CreatorScene({ config, anim }: { config: AnimalConfig; anim: { name: AnimName; start: number } | null }) {
  const quality = useSettings((s) => s.quality);
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 2.2, 6.2);
  }, [camera]);
  return (
    <>
      {/* 摄影棚：中性灰背景、主光 + 柔光补光 + 轮廓光，真实呈现毛色与材质 */}
      <color attach="background" args={['#141316']} />
      <fog attach="fog" args={['#141316', 9, 20]} />
      <hemisphereLight args={['#f2ece4', '#1a1816', 0.45]} />
      <spotLight position={[3, 6, 4]} angle={0.5} penumbra={0.8} intensity={110} color="#fff1e0" castShadow={quality !== 'low'} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <pointLight position={[-4, 2.4, 2]} intensity={14} color="#e8eef8" />
      <directionalLight position={[0, 4, -6]} intensity={1.4} color="#dfe8ff" />
      {quality !== 'low' && (
        <Environment resolution={128} frames={1}>
          <Lightformer intensity={2} color="#fff4e6" position={[3, 5, 4]} scale={[4, 4, 1]} />
          <Lightformer intensity={0.8} color="#e6eeff" position={[-5, 2, 1]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
        </Environment>
      )}
      <group>
        <Pedestal position={[0, -0.3, 0]} r={1.2} />
        <CreatorAnimal config={config} anim={anim} />
      </group>
      <Bursts density={quality === 'low' ? 0.5 : 1} />
      <ContactShadows position={[0, -0.29, 0]} opacity={0.45} scale={6} blur={2.4} far={3} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.31, 0]} receiveShadow>
        <circleGeometry args={[12, 48]} />
        <meshStandardMaterial color="#1c1a1d" roughness={0.7} />
      </mesh>
      <OrbitControls target={[0, 1.25, 0]} enablePan={false} minDistance={2.2} maxDistance={8} maxPolarAngle={Math.PI * 0.62} enableDamping makeDefault />
    </>
  );
}

/** 房间大厅：房间成员站在舞台上 */
export function LobbyScene({ members, playerId }: { members: LobbyMember[]; playerId: string | null }) {
  const quality = useSettings((s) => s.quality);
  const n = Math.max(1, members.length);
  const spacing = n > 5 ? 1.25 : 1.55;
  return (
    <>
      <SceneLights quality={quality} />
      <ClubEnvironment quality={quality} />
      <group position={[0, 0, -4.5]}>
        <PokerTableMesh />
      </group>
      {members.map((m, i) => {
        const x = (i - (n - 1) / 2) * spacing;
        const z = 1.2 - Math.abs(i - (n - 1) / 2) * 0.25;
        return (
          <group key={m.id} position={[x, 0, z]}>
            <Pedestal position={[0, 0, 0]} r={0.6} color={m.id === playerId ? '#9fb4c4' : m.ready ? '#8fae7a' : '#b58a3c'} />
            <group position={[0, 0.66, 0]} rotation={[0, -x * 0.08, 0]}>
              <ShowAnimal config={m.profile.animal} position={[0, 0, 0]} rotY={0} offset={i} scale={0.9} />
            </group>
            <Html position={[0, 3.05, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
              <div className={`lobby-tag ${m.ready ? 'ready' : ''}`}>
                {m.isHost && '👑 '}
                {m.profile.name}
                <span>{m.isAI ? 'AI' : m.connected ? (m.ready ? '已准备' : '未准备') : '离线'}</span>
              </div>
            </Html>
          </group>
        );
      })}
      {/* 右侧是房间面板：镜头向右偏，让舞台出现在画面左侧的空白区域 */}
      <DriftCamera pos={[1.7, 2.5, 9.4]} look={[1.7, 1.35, 0]} sway={0.3} />
    </>
  );
}
