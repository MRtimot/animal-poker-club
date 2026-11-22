import { Component, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGame } from './store/gameStore';
import { useSettings, Quality, QUALITY_NAME } from './store/settingsStore';
import { cameraFocus } from './three/camera/CameraRig';
import { useProfile } from './store/profileStore';
import { GameScene } from './three/scenes/GameScene';
import { CreatorScene, HomeScene, LobbyScene } from './three/scenes/ShowcaseScenes';
import { HomeWorld } from './three/scenes/HomeWorld';
import { SharedEnvironment } from './three/scenes/SceneLights';
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
import { voice } from './audio/voice';
import { LoginScreen, OnboardingScreen, ProfileLoading, ProfileScreen, SyncBadge, WelcomeBanner } from './ui/account/AccountScreens';
import { guestChosen, initAccount, useAccount } from './store/accountStore';
import { NetDebugPanel } from './ui/debug/NetDebugPanel';
import type { AnimName } from './store/fxStore';
import { useBrowserBack } from './ui/useBrowserBack';
import { session } from './net/session';

const DPR: Record<Quality, [number, number]> = { low: [0.75, 1], medium: [1, 1.5], high: [1, 2], ultra: [1.5, 2] };

/** 后期处理：极克制的泛光 + 暗角；极高画质下加入跟随镜头焦点的景深 */
function PostFX({ quality, game }: { quality: Quality; game: boolean }) {
  if (quality === 'low' || quality === 'medium') return null;
  if (quality === 'ultra' && game) {
    return (
      <EffectComposer multisampling={4}>
        <DepthOfField target={cameraFocus} worldFocusRange={7} bokehScale={1.4} />
        <Bloom intensity={0.22} luminanceThreshold={0.92} luminanceSmoothing={0.15} mipmapBlur />
        <Vignette eskil={false} offset={0.3} darkness={0.5} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={quality === 'ultra' ? 4 : 0}>
      <Bloom intensity={0.2} luminanceThreshold={0.92} luminanceSmoothing={0.15} mipmapBlur />
      <Vignette eskil={false} offset={0.3} darkness={0.45} />
    </EffectComposer>
  );
}

const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high', 'ultra'];

/**
 * 自动画质：持续监测帧率，若长时间低于 40 FPS 则自动降一级（只降不升，避免来回切换）。
 * 玩家不需要面对复杂的设置。
 */
function AutoQuality() {
  const acc = useRef({ frames: 0, t: performance.now(), low: 0 });
  useFrame(() => {
    const s = useSettings.getState();
    if (!s.autoQuality || document.visibilityState !== 'visible') return;
    const a = acc.current;
    a.frames++;
    const now = performance.now();
    if (now - a.t < 2000) return;
    const fps = (a.frames * 1000) / (now - a.t);
    a.frames = 0;
    a.t = now;
    // 后台标签页会被限速，忽略极低的读数
    if (fps < 8) return;
    a.low = fps < 40 ? a.low + 1 : 0;
    if (a.low >= 3) {
      a.low = 0;
      const i = QUALITY_ORDER.indexOf(s.quality);
      if (i > 0) {
        s.set({ quality: QUALITY_ORDER[i - 1] });
        useGame.getState().toast(`为保持流畅，画质已自动调整为「${QUALITY_NAME[QUALITY_ORDER[i - 1]]}」`);
      }
    }
  });
  return null;
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
  else if (screen === 'home') content = <HomeWorld />;
  else if (screen === 'creator' || screen === 'onboarding') content = <CreatorScene config={animal} anim={creatorAnim} />;
  else if (screen === 'room' && room) content = <LobbyScene members={room.members} playerId={playerId} />;
  else content = <HomeScene config={animal} />;

  return (
    <>
      <color attach="background" args={['#120a20']} />
      {screen !== 'creator' && screen !== 'onboarding' && <fog attach="fog" args={['#1a0f22', 16, 34]} />}
      <SharedEnvironment />
      {content}
      {screen === 'game' && cameraMode === 'free' && <OrbitControls target={[0, 1, 0]} maxPolarAngle={Math.PI * 0.48} minDistance={3} maxDistance={16} enableDamping makeDefault />}
      <PostFX quality={quality} game={screen === 'game'} />
      <FpsMeter />
      <AutoQuality />
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
  const tips = ['正在布置森林俱乐部…', '动物们正在入座…', '狐狸正在洗牌…', '正在擦亮筹码…'];
  return (
    <div className="loading-screen" style={{ opacity: done ? 0 : 1, pointerEvents: done ? 'none' : 'auto' }}>
      {/* 小狐狸正在洗牌 */}
      <div className="shuffler" aria-hidden>
        <span className="shuffler-fox">🦊</span>
        <div className="shuffler-deck">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.14}s` }} />
          ))}
        </div>
      </div>
      <h1 style={{ marginTop: 14, color: '#f2c94c', letterSpacing: 4 }}>动物扑克俱乐部</h1>
      <p className="small" style={{ margin: '6px 0 0', color: '#fff3c8' }}>正在准备牌桌……</p>
      <div className="loading-bar">
        <div style={{ width: `${p}%` }} />
      </div>
      <p className="muted small">{tips[Math.floor(p / 26) % tips.length]}</p>
      <div className="founder-badge" style={{ margin: '28px auto 0' }}>
        <span className="founder-crown">👑</span>
        <span className="founder-label">创始人</span>
        <span className="founder-name">Timothy Ong</span>
        <span className="founder-title">Founder of APEX</span>
      </div>
      <div className="tester-badge" style={{ margin: '10px auto 0' }}>
        <span className="tester-icon">🧪</span>
        <span className="tester-label">游戏测试员</span>
        <span className="tester-name">John</span>
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
  // 离开牌桌 / 关闭角色语音：立刻停止所有角色说话（不留下排队中的台词）
  const voiceOn = useSettings((s) => s.voiceEnabled);
  useEffect(() => {
    if (screen !== 'game' || !voiceOn) voice.stop();
  }, [screen, voiceOn]);
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
  useBrowserBack();
  const sceneKind = screen === 'game' ? 'game' : screen === 'creator' || screen === 'onboarding' ? 'creator' : screen === 'room' && room ? 'room' : 'home';

  useEffect(() => {
    // 先确认登录状态（服务器验证会话），再重连之前的在线房间
    void initAccount().then(() => {
      const a = useAccount.getState();
      const g = useGame.getState();
      if (a.status === 'guest' && !guestChosen() && g.screen === 'home') g.setScreen('login');
      if (a.status === 'signedIn' && a.account && !a.account.onboarded && g.screen === 'home') g.setScreen('onboarding');
      if (net.sessionId || a.status === 'signedIn') net.connect();
    });
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
      {/* 页面转场：3D 场景切换时先暗下来再淡入，避免模型瞬间替换 */}
      <div key={sceneKind} className="scene-fade" aria-hidden />
      <Directors />
      <div className="overlay">
        {screen === 'home' && <HomeScreen />}
        {screen === 'login' && <LoginScreen />}
        {screen === 'onboarding' && <OnboardingScreen />}
        {screen === 'profile' && <ProfileScreen />}
        {screen === 'quick' && <HubScreen />}
        {screen === 'online' && <OnlineScreen />}
        {screen === 'room' && room && <RoomLobby />}
        {screen === 'room' && !room && <OnlineScreen />}
        {screen === 'creator' && <CreatorScreen onAnim={setCreatorAnim} />}
        {screen === 'collection' && <CollectionScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'game' && hasView && <HudConnector />}
        {screen === 'game' && !hasView && (
          <div className="entering-table">
            <div className="next-hand">正在进入牌桌…</div>
            <Btn kind="ghost" size="sm" onClick={() => session.leave('home')}>
              🏠 返回首页
            </Btn>
          </div>
        )}
      </div>
      <ProfileLoading />
      <WelcomeBanner />
      <SyncBadge />
      <NetDebugPanel />
      <Toasts />
      <LoadingScreen done={ready} />
    </>
  );
}
