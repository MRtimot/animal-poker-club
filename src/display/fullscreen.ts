// 全屏管理（手机 / 平板沉浸模式的唯一入口）
// 只负责“画面怎么显示”：不持有、也不修改任何对局、房间、玩家或连接状态。
// 所有组件都通过这里进入 / 退出全屏，不在各自的组件里直接调用浏览器的全屏 API。
//
// 浏览器限制：
// · 全屏只能由玩家真实的点击触发 → 只在按钮的点击处理里调用（不在加载时、计时器或 useEffect 里调用）。
// · 不是所有浏览器都支持网页全屏（例如 iPhone 上的 Safari / Chrome 只能让视频全屏）→
//   按能力检测，不支持时不报错，进入“沉浸浏览模式”（整块屏幕 + 安全区，但不假装已经全屏）。
// · 玩家自己退出全屏（系统手势、返回键、按钮）后，不会马上自动重新进入。
import { create } from 'zustand';
import { useSettings } from '../store/settingsStore';
import { isPC } from '../utils/pc';

type FsDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
};

/** 当前的显示方式 */
export type DisplayMode =
  /** 网页全屏（浏览器界面已隐藏） */
  | 'fullscreen'
  /** 支持全屏，但现在没有全屏 */
  | 'windowed'
  /** 浏览器不支持网页全屏：沉浸浏览模式（整块屏幕 + 安全区） */
  | 'immersive'
  /** 已经从主屏幕以应用方式打开（本身没有浏览器界面） */
  | 'standalone';

/** 短暂显示的状态提示（1~2 秒后淡出） */
export interface DisplayNotice {
  id: number;
  kind: 'entered' | 'unavailable';
}

export interface FullscreenState {
  /** 浏览器是否支持网页全屏（能力检测，不按浏览器名称猜） */
  supported: boolean;
  /** 现在是否处于全屏（以浏览器的 fullscreenchange 为准，系统手势退出也会立即同步） */
  active: boolean;
  standalone: boolean;
  /** 玩家在本次打开期间自己退出过全屏：“自动”不再自动进入 */
  declined: boolean;
  /** 本次打开期间请求全屏失败过：“自动”不再尝试（不重复打扰） */
  failed: boolean;
  notice: DisplayNotice | null;
}

const doc = (): FsDocument | null => (typeof document !== 'undefined' ? (document as FsDocument) : null);
/** 全屏的对象：整个页面（3D 画布、界面、弹窗、提示都在里面，一起进入全屏） */
const target = (): FsElement | null => (typeof document !== 'undefined' ? (document.documentElement as FsElement) : null);

function detectSupported(): boolean {
  const d = doc();
  const el = target();
  if (!d || !el) return false;
  const enabled = d.fullscreenEnabled ?? d.webkitFullscreenEnabled ?? false;
  return !!enabled && (typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function');
}

function currentElement(): Element | null {
  const d = doc();
  if (!d) return null;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = (q: string) => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);
  return mm('(display-mode: fullscreen)') || mm('(display-mode: standalone)') || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const useFullscreen = create<FullscreenState>()(() => ({
  supported: detectSupported(),
  active: !!currentElement(),
  standalone: detectStandalone(),
  declined: false,
  failed: false,
  notice: null,
}));

let noticeId = 0;
const notify = (kind: DisplayNotice['kind']) => useFullscreen.setState({ notice: { id: ++noticeId, kind } });
export function clearDisplayNotice(id: number) {
  if (useFullscreen.getState().notice?.id === id) useFullscreen.setState({ notice: null });
}

export function displayMode(s: Pick<FullscreenState, 'supported' | 'active' | 'standalone'> = useFullscreen.getState()): DisplayMode {
  if (s.active) return 'fullscreen';
  if (s.standalone) return 'standalone';
  return s.supported ? 'windowed' : 'immersive';
}

export function isSupported() {
  return useFullscreen.getState().supported;
}
export function isFullscreen() {
  return useFullscreen.getState().active;
}

/** 浏览器的全屏状态变化（进入、按钮退出、系统手势 / 返回键退出）：唯一的状态来源 */
export function handleFullscreenChange() {
  const was = useFullscreen.getState().active;
  const active = !!currentElement();
  if (was === active) return;
  // 退出（无论用哪种方式）都视为玩家的选择：“自动”在本次打开期间不再自动进入
  useFullscreen.setState(active ? { active } : { active, declined: true });
  if (active) notify('entered');
  syncRootClass();
}

/** 请求失败（浏览器拒绝、没有用户手势、被策略禁止）：不报错，继续以沉浸浏览模式游戏 */
export function handleFullscreenError(manual: boolean) {
  useFullscreen.setState({ failed: true });
  if (manual) notify('unavailable');
}

/**
 * 进入全屏。必须在玩家点击的处理函数里同步调用（浏览器要求真实的用户手势）。
 * @returns 是否已处于全屏（失败或不支持时返回 false，游戏照常继续）
 */
export async function enter(manual = true): Promise<boolean> {
  const el = target();
  if (!el || !detectSupported()) {
    if (manual) notify('unavailable');
    return false;
  }
  if (currentElement()) return true;
  try {
    // 安卓 Chrome：同时隐藏底部导航栏
    const opts: FullscreenOptions = { navigationUI: 'hide' };
    const r = el.requestFullscreen ? el.requestFullscreen(opts) : el.webkitRequestFullscreen?.(opts);
    if (r && typeof (r as Promise<void>).then === 'function') await r;
    handleFullscreenChange();
    return !!currentElement();
  } catch {
    handleFullscreenError(manual);
    return false;
  }
}

/** 退出全屏（玩家的选择：之后“自动”不会再自动进入） */
export async function exit(): Promise<void> {
  const d = doc();
  if (!d || !currentElement()) return;
  useFullscreen.setState({ declined: true });
  try {
    const r = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.();
    if (r && typeof (r as Promise<void>).then === 'function') await r;
  } catch {
    /* 已经不在全屏（例如系统同时退出）：以 fullscreenchange 为准 */
  }
  handleFullscreenChange();
}

export function toggle(): Promise<boolean | void> {
  return currentElement() ? exit() : enter(true);
}

/**
 * 进入游戏的按钮（开始游戏、创建房间、加入房间、开始对局）被点击时调用：按玩家的全屏偏好决定是否进入全屏。
 * 只在手机 / 平板生效（电脑版不改变任何行为），只在支持的浏览器上尝试，失败时静默继续。
 */
export function enterOnEntryGesture(): void {
  if (isPC()) return;
  const s = useFullscreen.getState();
  if (!s.supported || s.active || s.standalone) return;
  const pref = useSettings.getState().fullscreenPreference;
  if (pref === 'off') return;
  if (pref === 'auto' && (s.declined || s.failed)) return;
  void enter(false);
}

/** 在 <html> 上标记显示方式，供样式使用（全屏 / 沉浸浏览模式都使用整块屏幕与安全区） */
function syncRootClass() {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root) return;
  const mode = displayMode();
  root.classList.toggle('apc-fullscreen', mode === 'fullscreen');
  root.classList.toggle('apc-immersive', mode === 'immersive');
}

// 监听只安装一次（开发时模块热更新会先移除旧的监听，避免重复）
type Installed = { change: () => void; error: () => void };
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  const w = window as Window & { __apcFullscreen?: Installed };
  const old = w.__apcFullscreen;
  if (old) {
    for (const t of ['fullscreenchange', 'webkitfullscreenchange']) document.removeEventListener(t, old.change);
    for (const t of ['fullscreenerror', 'webkitfullscreenerror']) document.removeEventListener(t, old.error);
  }
  const installed: Installed = { change: handleFullscreenChange, error: () => handleFullscreenError(false) };
  for (const t of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(t, installed.change);
  for (const t of ['fullscreenerror', 'webkitfullscreenerror']) document.addEventListener(t, installed.error);
  w.__apcFullscreen = installed;
  syncRootClass();
}
