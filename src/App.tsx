import { Component, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGame } from './store/gameStore';
import { useSettings, Quality } from './store/settingsStore';
import { useProfile } from './store/profileStore';
import { GameScene } from './three/scenes/GameScene';
import { CreatorScene, HomeScene, LobbyScene } from './three/scenes/ShowcaseScenes';
import { HomeScreen } from './ui/home/HomeScreen';
import { HubScreen } from './ui/home/HubScreen';
import { OnlineScreen } from './ui/lobby/OnlineScreen';
import { RoomLobby } from './ui/lobby/RoomLobby';
import { CreatorScreen } from './ui/creator/CreatorScreen';
import { CollectionScreen } from './ui/collection/CollectionScreen';
import { SettingsScreen } from './ui/settings/SettingsScreen';
import { GameHUD } from './ui/game/GameHUD';
import { Btn, Toasts } from './ui/common/ui';
import { useChatReactions, useTableDirector } from './animation/director';
import { useProgressTracker } from './progress/tracker';
import { net } from './net/netClient';
import type { AnimName } from './store/fxStore';

const DPR: Record<Quality, [number, number]> = { low: [0.75, 1], medium: [1, 1.5], high: [1, 2], ultra: [1.5, 2] };

function PostFX({ quality, game }: { quality: Quality; game: boolean }) {
  if (quality === 'low' || quality === 'medium') return null;
  if (quality === 'ultra' && game) {
    return (
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.7} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
        <DepthOfField focusDistance={0.012} focalLength={0.06} bokehScale={2.2} />
        <Vignette eskil={false} offset={0.25} darkness={0.55} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={quality === 'ultra' ? 4 : 0}>
      <Bloom intensity={0.6} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
      <Vignette eskil={false} offset={0.25} darkness={0.5} />
    </EffectComposer>
  );
}

function FpsMeter() {
  const show = useSettings((s) => s.showFps);
  const ref = useRef<HTMLDivElement | null>(null);
  const acc = useRef({ frames: 0, t: performance.now() });
  useEffect(() => {
    if (!show) return;
    const el = document.createElement('div');
    el.className = 'fps';
    document.body.appendChild(el);
    ref.current = el;
    return () => {
      el.remove();
      ref.current = null;
    };
  }, [show]);
  useFrame(() => {
    if (!ref.current) return;
    const a = acc.current;
    a.frames++;
    const now = performance.now();
    if (now - a.t > 500) {
      ref.current.textContent = `${Math.round((a.frames * 1000) / (now - a.t))} FPS`;
      a.frames = 0;
      a.t = now;
    }
  });
  return null;
}

function Scene({ creatorAnim }: { creatorAnim: { name: AnimName; start: number } | null }) {
  const screen = useGame((s) => s.screen);
  const view = useGame((s) => s.view);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const cameraMode = useGame((s) => s.cameraMode);
  const animal = useProfile((s) => s.animal);
  const quality = useSettings((s) => s.quality);

  let content: ReactNode;
  if (screen === 'game' && view) content = <GameScene view={view} />;
  else if (screen === 'creator') content = <CreatorScene config={animal} anim={creatorAnim} />;
  else if (screen === 'room' && room) content = <LobbyScene members={room.members} playerId={playerId} />;
  else content = <HomeScene config={animal} />;

  return (
    <>
      <color attach="background" args={['#120a20']} />
      {screen !== 'creator' && <fog attach="fog" args={['#1a0f22', 16, 34]} />}
      {content}
      {screen === 'game' && cameraMode === 'free' && <OrbitControls target={[0, 1, 0]} maxPolarAngle={Math.PI * 0.48} minDistance={3} maxDistance={16} enableDamping makeDefault />}
      <PostFX quality={quality} game={screen === 'game'} />
      <FpsMeter />
    </>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    if (this.state.error)
      return (
        <div className="loading-screen">
          <div className="animals">😿</div>
          <h2 style={{ margin: '12px 0' }}>3D 场景加载失败</h2>
          <p className="muted" style={{ maxWidth: 420 }}>
            你的浏览器可能不支持 WebGL，或显卡驱动出现问题。请尝试更新浏览器，或在设置中把画质调到「低」。
          </p>
          <p className="small muted">错误信息：{this.state.error}</p>
          <div>
            <Btn onClick={() => location.reload()}>重新加载</Btn>
          </div>
        </div>
      );
    return this.props.children;
  }
}

function LoadingScreen({ done }: { done: boolean }) {
  const [gone, setGone] = useState(false);
  const [p, setP] = useState(8);
  useEffect(() => {
    const iv = setInterval(() => setP((x) => Math.min(92, x + Math.random() * 18)), 160);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    if (!done) return;
    setP(100);
    const t = setTimeout(() => setGone(true), 650);
    return () => clearTimeout(t);
  }, [done]);
  if (gone) return null;
  const tips = ['正在布置森林俱乐部…', '动物们正在入座…', '正在洗牌…', '正在擦亮筹码…'];
  return (
    <div className="loading-screen" style={{ opacity: done ? 0 : 1, pointerEvents: done ? 'none' : 'auto' }}>
      <div className="animals">
        {['🐱', '🦊', '🐼', '🐸', '🦁'].map((e, i) => (
          <span key={e} style={{ animationDelay: `${i * 0.12}s` }}>
            {e}
          </span>
        ))}
      </div>
      <h1 style={{ marginTop: 14, color: '#f2c94c', letterSpacing: 4 }}>动物扑克俱乐部</h1>
      <div className="loading-bar">
        <div style={{ width: `${p}%` }} />
      </div>
      <p className="muted small">{tips[Math.floor(p / 26) % tips.length]}</p>
      <div className="founder-badge" style={{ margin: '28px auto 0' }}>
        <span className="founder-crown">👑</span>
        <span className="founder-label">创始人</span>
        <span className="founder-name">Timothy Ong</span>
      </div>
    </div>
  );
}

function Directors() {
  const view = useGame((s) => s.view);
  const mode = useGame((s) => s.mode);
  const screen = useGame((s) => s.screen);
  const active = screen === 'game' ? view : null;
  useTableDirector(active);
  useChatReactions(active);
  useProgressTracker(view, mode);
  return null;
}

function HudConnector() {
  const view = useGame((s) => s.view);
  return view ? <GameHUD view={view} /> : null;
}

export default function App() {
  const screen = useGame((s) => s.screen);
  // 只订阅“是否有牌桌”，避免每次状态同步都重新渲染整个画布
  const hasView = useGame((s) => s.view !== null);
  const room = useGame((s) => s.room);
  const quality = useSettings((s) => s.quality);
  const [ready, setReady] = useState(false);
  const shadows = useMemo(
    () => (quality !== 'low' ? { enabled: true, type: quality === 'medium' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap } : false),
    [quality],
  );
  const glOptions = useMemo(() => ({ antialias: quality !== 'low', powerPreference: 'high-performance' as const }), [quality]);
  const restoreTimer = useRef<number | null>(null);
  const rebuilds = useRef(0);
  const [creatorAnim, setCreatorAnim] = useState<{ name: AnimName; start: number } | null>(null);
  // WebGL 上下文丢失（显卡驱动重置 / 内存不足）时自动重建画布
  const [canvasKey, setCanvasKey] = useState(0);

  useEffect(() => {
    // 若之前在在线房间中（例如刷新了页面），自动重连回去
    if (net.sessionId) net.connect();
  }, []);

  return (
    <>
      <ErrorBoundary>
        <Canvas
          key={canvasKey}
          className="app-canvas"
          shadows={shadows}
          dpr={DPR[quality]}
          gl={glOptions}
          camera={{ fov: 45, position: [0, 3, 9], near: 0.1, far: 80 }}
          onCreated={({ gl, scene }) => {
            setTimeout(() => setReady(true), 400);
            if (import.meta.env.DEV) Object.assign(window as any, { __gl: gl, __scene: scene });
            // 上下文丢失：先等浏览器自动恢复（three.js 会重新上传资源），超时才重建画布
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              if (restoreTimer.current) return;
              restoreTimer.current = window.setTimeout(() => {
                restoreTimer.current = null;
                if (rebuilds.current < 2) {
                  rebuilds.current++;
                  useGame.getState().toast('3D 画面重新加载中…');
                  setCanvasKey((k) => k + 1);
                }
              }, 3000);
            });
            gl.domElement.addEventListener('webglcontextrestored', () => {
              if (restoreTimer.current) clearTimeout(restoreTimer.current);
              restoreTimer.current = null;
            });
          }}
        >
          <Suspense fallback={null}>
            <Scene creatorAnim={creatorAnim} />
          </Suspense>
        </Canvas>
      </ErrorBoundary>
      <Directors />
      <div className="overlay">
        {screen === 'home' && <HomeScreen />}
        {screen === 'quick' && <HubScreen />}
        {screen === 'online' && <OnlineScreen />}
        {screen === 'room' && room && <RoomLobby />}
        {screen === 'room' && !room && <OnlineScreen />}
        {screen === 'creator' && <CreatorScreen onAnim={setCreatorAnim} />}
        {screen === 'collection' && <CollectionScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'game' && hasView && <HudConnector />}
        {screen === 'game' && !hasView && <div className="next-hand">正在进入牌桌…</div>}
      </div>
      <Toasts />
      <LoadingScreen done={ready} />
    </>
  );
}
