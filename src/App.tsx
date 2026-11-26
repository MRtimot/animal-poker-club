import { Component, Fragment, ReactNode, Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType, type ErrorInfo, type LazyExoticComponent } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useGame, type Screen } from './store/gameStore';
import { useSettings, Quality, QUALITY_NAME } from './store/settingsStore';
import { useProfile } from './store/profileStore';
import { CreatorScene, HomeScene, LobbyScene } from './three/scenes/ShowcaseScenes';
import { HomeWorld } from './three/scenes/HomeWorld';
import { SharedEnvironment } from './three/scenes/SceneLights';
import { HomeScreen } from './ui/home/HomeScreen';
import { Btn, Toasts } from './ui/common/ui';
import { useChatReactions, useTableDirector } from './animation/director';
import { useProgressTracker } from './progress/tracker';
import { net } from './net/netClient';
import { voice } from './audio/voice';
import { sound } from './audio/sound';
import { LoginScreen, OnboardingScreen, ProfileLoading, ProfileScreen, SyncBadge, WelcomeBanner } from './ui/account/AccountScreens';
import { guestChosen, initAccount, useAccount } from './store/accountStore';
import { NetDebugPanel } from './ui/debug/NetDebugPanel';
import { AudioResumeHint } from './ui/common/AudioResumeHint';
import { ConsentLayer } from './ui/privacy/ConsentUI';
import { GameNoticeLayer } from './ui/notice/GameNotice';
import type { AnimName } from './store/fxStore';
import { useBrowserBack } from './ui/useBrowserBack';
import { session } from './net/session';
import { isPC } from './utils/pc';
import { PremiumLoader } from './ui/boot/PremiumLoader';
import { MobileLoader } from './ui/boot/MobileLoader';
import { BootProbe } from './boot/BootProbe';
import { markBoot, markBootDegraded, useBoot } from './boot/boot';
import { homeTimeline } from './ui/home/homeTimeline';
import { FullscreenNotice } from './ui/common/FullscreenUI';
import { useDefeatDirector } from './animation/defeat/useDefeatDirector';
import { useBlackjackDirector } from './animation/blackjack/useBlackjackDirector';
import { useBlackjackProgress } from './progress/blackjackTracker';

const DPR: Record<Quality, [number, number]> = { low: [0.75, 1], medium: [1, 1.5], high: [1, 2], ultra: [1.5, 2] };

// ───────────── 按需加载（代码拆分）─────────────
// 首页只下载首页需要的代码；牌桌、牌桌界面、动物创建器、大厅、设置等在需要时才加载，
// 首页空闲后会在后台预取，切换页面时通常已经下载好。
const loadGameScene = () => import('./three/scenes/GameScene');
const loadGameHUD = () => import('./ui/game/GameHUD');
const loadBlackjackScene = () => import('./three/blackjack/BlackjackScene');
const loadBlackjackHUD = () => import('./ui/blackjack/BlackjackHUD');
const loadCreator = () => import('./ui/creator/CreatorScreen');
const loadHub = () => import('./ui/home/HubScreen');
const loadOnline = () => import('./ui/lobby/OnlineScreen');
const loadLobby = () => import('./ui/lobby/RoomLobby');
const loadCollection = () => import('./ui/collection/CollectionScreen');
const loadSettings = () => import('./ui/settings/SettingsScreen');
const loadPostFX = () => import('./three/PostFX');
/** 是否是“页面代码下载失败”（网络问题），而不是代码或显卡出错（各浏览器的提示不同） */
function isLoadError(message: string): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|Failed to fetch/i.test(message);
}

/** 下载失败、等待重新下载的页面代码（错误边界恢复时统一换成新的加载器） */
const failedLoads = new Set<() => void>();
/** 错误边界恢复（切换页面、点“重试” / “返回首页”）时调用：之前下载失败的页面代码下次显示时重新下载 */
function retryFailedLoads() {
  for (const reset of failedLoads) reset();
  failedLoads.clear();
}

/**
 * 可以重试的按需加载：React.lazy 会永远记住第一次下载失败（手机网络抖动一下，之后整个页面会话里
 * 牌桌 3D / 这个页面都无法再显示，只能刷新网页）。
 * 下载失败时只做记录，不立即换新的加载器：React 出错后会马上再渲染一次，那时如果已经换成新的加载器，
 * 就会立刻重新下载、再失败、再下载……（无限请求，错误界面也出不来）。
 * 只有错误边界真正恢复时（retryFailedLoads）才换新的加载器；浏览器会重新请求失败的模块。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyRetry<C extends ComponentType<any>>(load: () => Promise<{ default: C }>): C {
  const make = (): LazyExoticComponent<C> =>
    lazy(async () => {
      try {
        return await load();
      } catch (e) {
        failedLoads.add(() => (current = make()));
        throw e;
      }
    });
  let current = make();
  const LazyRetry = (props: ComponentProps<C>) => {
    const L = current as unknown as ComponentType<ComponentProps<C>>;
    return <L {...props} />;
  };
  return LazyRetry as unknown as C;
}
const GameScene = lazyRetry(() => loadGameScene().then((m) => ({ default: m.GameScene })));
const GameHUD = lazyRetry(() => loadGameHUD().then((m) => ({ default: m.GameHUD })));
const BlackjackScene = lazyRetry(() => loadBlackjackScene().then((m) => ({ default: m.BlackjackScene })));
const BlackjackHUD = lazyRetry(() => loadBlackjackHUD().then((m) => ({ default: m.BlackjackHUD })));
const CreatorScreen = lazyRetry(() => loadCreator().then((m) => ({ default: m.CreatorScreen })));
const HubScreen = lazyRetry(() => loadHub().then((m) => ({ default: m.HubScreen })));
const OnlineScreen = lazyRetry(() => loadOnline().then((m) => ({ default: m.OnlineScreen })));
const RoomLobby = lazyRetry(() => loadLobby().then((m) => ({ default: m.RoomLobby })));
const CollectionScreen = lazyRetry(() => loadCollection().then((m) => ({ default: m.CollectionScreen })));
const SettingsScreen = lazyRetry(() => loadSettings().then((m) => ({ default: m.SettingsScreen })));
const PostFXLazy = lazyRetry(loadPostFX);

/** 首屏完成后，在浏览器空闲时预取其他页面的代码（失败也没关系，真正进入时会重试） */
function prefetchScreens() {
  const run = () => {
    for (const load of [loadHub, loadOnline, loadLobby, loadGameScene, loadGameHUD, loadBlackjackScene, loadBlackjackHUD, loadCreator, loadSettings, loadCollection]) load().catch(() => undefined);
    if (useSettings.getState().quality === 'high' || useSettings.getState().quality === 'ultra') loadPostFX().catch(() => undefined);
  };
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(run, { timeout: 4000 });
  else window.setTimeout(run, 1500);
}

/** 后期处理只在“高 / 极高”画质加载 */
function PostFX({ quality, game }: { quality: Quality; game: boolean }) {
  if (quality === 'low' || quality === 'medium') return null;
  return <PostFXLazy quality={quality} game={game} />;
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
  const bj = useGame((s) => s.bj);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const cameraMode = useGame((s) => s.cameraMode);
  const animal = useProfile((s) => s.animal);
  const quality = useSettings((s) => s.quality);

  let content: ReactNode;
  if (screen === 'game' && bj) content = <BlackjackScene view={bj} />;
  else if (screen === 'game' && view) content = <GameScene view={view} />;
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

/**
 * 3D 场景的错误边界：WebGL 不可用、显卡驱动问题或场景代码出错时，只让 3D 退回静态背景，
 * 页面文字、按钮、设置照常可用（不会白屏、不会卡在加载画面）。
 * 切换到其他场景时自动重试（例如牌桌场景出错后回到首页，首页的 3D 可以正常显示）。
 */
class SceneErrorBoundary extends Component<{ children: ReactNode; resetKey: string; onError: () => void; onRetry: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message || String(e) };
  }
  componentDidCatch(e: Error) {
    console.error('[3D] 场景出错，已切换为静态背景：', e);
    this.props.onError();
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      retryFailedLoads();
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error)
      return (
        <>
          <div className="webgl-fallback" aria-hidden />
          {/* 提示不能放在背景里面：背景是固定定位的全屏层，会把提示压在整个界面层（牌桌操作栏、页面）下面，“重试”按不到 */}
          <div className={`webgl-fallback-note${this.props.resetKey === 'game' ? ' in-game' : ''}`} role="status">
            <b>😿 3D 场景无法显示</b>
            <span>
              {isLoadError(this.state.error)
                ? '3D 画面没有下载完成，可能是网络不稳定。页面其他功能仍可使用，网络恢复后点“重试”。'
                : '浏览器可能不支持 WebGL 或显卡驱动有问题。页面其他功能仍可使用；也可以在设置中把画质调到「低」后重试。'}
            </span>
            <Btn
              size="sm"
              kind="ghost"
              onClick={() => {
                retryFailedLoads();
                this.setState({ error: null });
                this.props.onRetry();
              }}
            >
              重试
            </Btn>
          </div>
        </>
      );
    return this.props.children;
  }
}

/**
 * 页面界面的错误边界：任何页面（牌桌界面、大厅、设置…）出错时显示可恢复的提示，
 * “返回首页”会走正常的离开流程（停止 AI / 离开房间 / 清理牌局状态），不会白屏、不需要刷新。
 */
class ScreenErrorBoundary extends Component<{ children: ReactNode; screen: Screen }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message || String(e) };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error(`[界面] 「${this.props.screen}」页面出错：`, e, info.componentStack);
  }
  componentDidUpdate(prev: { screen: Screen }) {
    if (this.state.error && prev.screen !== this.props.screen) {
      retryFailedLoads();
      this.setState({ error: null });
    }
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen-error" role="alert">
        <div className="panel screen-error-card">
          <h2>😿 这个页面出了点问题</h2>
          <p className="muted">别担心，你的等级、金币、动物和存档都安全。返回首页后可以继续游戏。</p>
          <p className="small muted">错误信息：{this.state.error}</p>
          <Btn
            onClick={() => {
              session.leave('home');
              retryFailedLoads();
              this.setState({ error: null });
            }}
          >
            🏠 返回首页
          </Btn>
        </div>
      </div>
    );
  }
}

/** 后台逻辑（牌局导演、成就统计、语音清理）的错误边界：出错时只停止这一部分，不影响页面；切换页面后自动恢复 */
class QuietBoundary extends Component<{ children: ReactNode; resetKey: string; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: Error) {
    console.error(`[${this.props.name}] 出错，已暂停这一部分：`, e);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * 最外层的安全网：任何没有被内层捕获的错误都不会让页面变成空白。
 * “返回首页”会正常离开牌局 / 房间并重新创建整个界面（不刷新网页、不丢失存档）。
 */
class RootErrorBoundary extends Component<{ children: ReactNode }, { error: string | null; generation: number }> {
  state = { error: null as string | null, generation: 0 };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message || String(e) };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error('[应用] 未处理的界面错误：', e, info.componentStack);
  }
  render() {
    if (!this.state.error) return <Fragment key={this.state.generation}>{this.props.children}</Fragment>;
    return (
      <div className="screen-error" role="alert">
        <div className="panel screen-error-card">
          <h2>😿 游戏出了点问题</h2>
          <p className="muted">你的等级、金币、动物和存档都安全。返回首页后可以继续游戏。</p>
          <p className="small muted">错误信息：{this.state.error}</p>
          <Btn
            onClick={() => {
              session.leave('home');
              retryFailedLoads();
              this.setState((s) => ({ error: null, generation: s.generation + 1 }));
            }}
          >
            🏠 返回首页
          </Btn>
        </div>
      </div>
    );
  }
}

function Directors() {
  const view = useGame((s) => s.view);
  const mode = useGame((s) => s.mode);
  const screen = useGame((s) => s.screen);
  const bj = useGame((s) => s.bj);
  const active = screen === 'game' ? view : null;
  const activeBj = screen === 'game' ? bj : null;
  useTableDirector(active);
  // 失败演出：自己输掉关键一手（出局 / 一手输掉一半以上筹码）时的电影化演出（只是画面表现）
  useDefeatDirector(active);
  useBlackjackDirector(activeBj);
  useChatReactions(active, activeBj);
  useProgressTracker(view, mode);
  useBlackjackProgress(bj, mode);
  // 离开牌桌 / 关闭角色语音：立刻停止所有角色说话（不留下排队中的台词）
  const voiceOn = useSettings((s) => s.voiceEnabled);
  useEffect(() => {
    if (screen !== 'game' || !voiceOn) voice.stop();
  }, [screen, voiceOn]);
  // 任何方式离开牌桌（离开按钮、浏览器返回、房间关闭）：停掉还在响 / 已排程的牌桌与演出声音，不带到别的页面
  useEffect(() => {
    if (screen !== 'game') return;
    return () => sound.stopTransient();
  }, [screen]);
  // 首页是展示层：不在房间里时不保持多人连接
  useEffect(() => {
    if (screen === 'home') net.releaseIfIdle();
  }, [screen]);
  return null;
}

function HudConnector() {
  const view = useGame((s) => s.view);
  const bj = useGame((s) => s.bj);
  if (bj) return <BlackjackHUD view={bj} />;
  return view ? <GameHUD view={view} /> : null;
}

export default function App() {
  return (
    <RootErrorBoundary>
      <AppContent />
    </RootErrorBoundary>
  );
}

function AppContent() {
  const screen = useGame((s) => s.screen);
  // 只订阅“是否有牌桌”，避免每次状态同步都重新渲染整个画布
  const hasView = useGame((s) => s.view !== null || s.bj !== null);
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
  // 加载页：按真实启动步骤显示进度（boot.ts），电脑版与手机版共用同一套流程，只是画面不同
  // （电脑版 PremiumLoader；手机与平板 MobileLoader）。打开页面时决定一次，加载途中改变窗口大小不会切换。
  const [pcBoot] = useState(isPC);
  useLayoutEffect(() => {
    // 首页开场（镜头推进、动物入座）在加载页揭幕时才开始
    homeTimeline.held = true;
  }, []);
  // 页面代码已运行、存档与设置已读取，等界面字体就绪（系统字体通常立即就绪；最多等 3 秒，不让字体阻塞进入）
  useEffect(() => {
    let alive = true;
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
    void Promise.race([fonts, new Promise((r) => window.setTimeout(r, 3000))]).then(() => alive && markBoot('core'));
    return () => {
      alive = false;
    };
  }, []);
  // 加载页的“重试”：只重建 3D 画布（不重复初始化页面、存档或连接）。
  // 加载卡住时由加载页显示原因、重试或先进入，不再用固定的超时直接结束
  useEffect(() => useBoot.subscribe((s, p) => s.attempt !== p.attempt && setCanvasKey((k) => k + 1)), []);
  // 首屏完成后预取其他页面代码
  useEffect(() => {
    if (ready) prefetchScreens();
  }, [ready]);
  const sceneKind = screen === 'game' ? 'game' : screen === 'creator' || screen === 'onboarding' ? 'creator' : screen === 'room' && room ? 'room' : 'home';

  useEffect(() => {
    // 先确认登录状态（服务器验证会话），再重连之前的在线房间
    void initAccount().then(() => {
      const a = useAccount.getState();
      const g = useGame.getState();
      if (a.status === 'guest' && !guestChosen() && g.screen === 'home') g.setScreen('login');
      if (a.status === 'signedIn' && a.account && !a.account.onboarded && g.screen === 'home') g.setScreen('onboarding');
      // 首页不主动连接多人服务器：只有刷新前正在房间里（需要回到座位）才自动重连；
      // 其他情况在真正创建 / 加入房间、开始服务器对局时才连接
      if (net.sessionId && net.wasInRoom) net.connect();
    });
  }, []);

  return (
    <>
      <SceneErrorBoundary
        resetKey={sceneKind}
        onError={() => {
          setReady(true);
          // 3D 不可用不阻塞进入首页（首页显示静态背景与“3D 无法显示”的提示和重试）
          markBootDegraded();
        }}
        onRetry={() => setCanvasKey((k) => k + 1)}
      >
        <Canvas
          key={canvasKey}
          className="app-canvas"
          shadows={shadows}
          dpr={DPR[quality]}
          gl={glOptions}
          camera={{ fov: 45, position: [0, 3, 9], near: 0.1, far: 80 }}
          onCreated={({ gl, scene, camera }) => {
            markBoot('gl');
            if (import.meta.env.DEV) Object.assign(window as any, { __gl: gl, __scene: scene, __camera: camera });
            // 上下文丢失：先等浏览器自动恢复（three.js 会重新上传资源），超时才重建画布
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              // 画布被正常替换（加载页“重试”、3D 出错后的“重试”）时，旧画布释放上下文也会触发这个事件：
              // 那不是显卡出错，不能再重建一次画布（以前会多重建一次，并提示“3D 画面重新加载中”）
              if (!gl.domElement.isConnected || restoreTimer.current) return;
              restoreTimer.current = window.setTimeout(() => {
                restoreTimer.current = null;
                if (!gl.domElement.isConnected) return;
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
            {/* 场景搭建完成 → 预编译着色器 → 渲染出最初几帧，作为加载页的真实进度 */}
            <BootProbe />
          </Suspense>
        </Canvas>
      </SceneErrorBoundary>
      {/* 页面转场：3D 场景切换时先暗下来再淡入，避免模型瞬间替换 */}
      <div key={sceneKind} className="scene-fade" aria-hidden />
      <QuietBoundary name="牌局导演" resetKey={screen}>
        <Directors />
      </QuietBoundary>
      <div className="overlay">
        <ScreenErrorBoundary screen={screen}>
        <Suspense fallback={<div className="screen-loading" aria-live="polite">正在打开…</div>}>
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
        </Suspense>
        </ScreenErrorBoundary>
      </div>
      <ProfileLoading />
      <WelcomeBanner />
      <SyncBadge />
      <AudioResumeHint />
      <NetDebugPanel />
      <Toasts />
      <FullscreenNotice />
      <ConsentLayer />
      {/* 游戏说明：加载页退场后、第一次在首页 / 模式选择时出现一次 */}
      <GameNoticeLayer />
      {pcBoot ? <PremiumLoader onReady={() => setReady(true)} /> : <MobileLoader onReady={() => setReady(true)} />}
    </>
  );
}
