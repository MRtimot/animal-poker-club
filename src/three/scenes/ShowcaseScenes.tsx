import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { AnimalModel } from '../animals/AnimalModel';
import { AnimalConfig, randomAnimal } from '../../core/player/profile';
import type { LobbyMember } from '../../core/protocol';
import { ClubEnvironment, PokerTableMesh } from '../environment/ClubEnvironment';
import { SceneLights } from './SceneLights';
import { useSettings } from '../../store/settingsStore';
import { AnimName } from '../../store/fxStore';
import { GEO, mat } from '../animals/materials';
import { seededRandom } from '../../core/utils/random';

function Pedestal({ position, color = '#c9a227', r = 0.9 }: { position: [number, number, number]; color?: string; r?: number }) {
  return (
    <group position={position}>
      <mesh geometry={GEO.cyl} material={mat('#3d2014', { rough: 0.4 })} position={[0, 0.12, 0]} scale={[r, 0.24, r]} castShadow receiveShadow />
      <mesh geometry={GEO.torus} material={mat(color, { rough: 0.3, metal: 0.8 })} position={[0, 0.24, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[r, r, 0.4]} />
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
            <Pedestal position={[x, 0, z]} r={0.75} color={['#e94f9a', '#5fe1ff', '#7dff8a'][k - 1]} />
            <ShowAnimal config={f} position={[x, 0.66, z]} rotY={-side * 0.35} offset={i + 1} />
          </group>
        );
      })}
      <DriftCamera pos={[0, 2.6, 7.6]} look={[0, 1.55, 0]} />
    </>
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
      <color attach="background" args={['#1b1230']} />
      <fog attach="fog" args={['#1b1230', 9, 20]} />
      <hemisphereLight args={['#ffe2f0', '#2a1840', 0.8]} />
      <spotLight position={[3, 6, 4]} angle={0.5} penumbra={0.6} intensity={90} castShadow={quality !== 'low'} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <pointLight position={[-4, 2, -2]} intensity={25} color="#ff5fa8" />
      <pointLight position={[4, 2, -3]} intensity={25} color="#5fe1ff" />
      <group>
        <Pedestal position={[0, -0.3, 0]} r={1.2} color="#ff5fa8" />
        <group position={[0, 0.36, 0]}>
          <AnimalModel config={config} anim={anim} seed={3} />
        </group>
      </group>
      <ContactShadows position={[0, -0.29, 0]} opacity={0.45} scale={6} blur={2.4} far={3} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.31, 0]} receiveShadow>
        <circleGeometry args={[12, 48]} />
        <meshStandardMaterial color="#24173d" roughness={0.9} />
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
            <Pedestal position={[0, 0, 0]} r={0.6} color={m.id === playerId ? '#5fe1ff' : m.ready ? '#7dff8a' : '#c9a227'} />
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
