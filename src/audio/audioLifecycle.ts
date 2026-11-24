// 音频生命周期（MobileAudioUnlockManager）：整个页面只注册一次的用户手势 / 前后台监听。
//
// · 解锁：浏览器只在“用户激活”事件里允许开始播放声音。按 HTML 规范，触摸屏上的 pointerdown 不算激活，
//   真正算数的是 pointerup / touchend / click（以及鼠标的 pointerdown、非 Esc 的按键）。
//   以前只监听 pointerdown：手机上第一次点击创建的 AudioContext 一直是 suspended，
//   Android 要点第二次才有声音，iPhone Safari 每次都需要手势里的 resume()，所以可能一直没有声音。
// · 后台：手机切到后台 / 锁屏 / 切换 App 时暂停整个 AudioContext 并停止角色语音；
//   回到前台时尝试恢复，浏览器不允许就等下一次点击（界面显示“点击继续声音”），不报错。
//   电脑版不在后台暂停（保持原来的行为）。
// · 同一个手势里也可能触发全屏请求：全屏和声音是两种独立的浏览器能力，互不依赖。
import { isTouchPrimary, sound } from './sound';
import { voice } from './voice';
import { useSettings } from '../store/settingsStore';

/** 会带来“用户激活”的事件（捕获阶段、被动监听：不影响任何按钮自己的点击处理） */
export const ACTIVATION_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

type Listener = (e: Event) => void;
interface Target {
  addEventListener(type: string, fn: Listener, opts?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, fn: Listener, opts?: EventListenerOptions | boolean): void;
}

export interface AudioLifecycleEnv {
  win: Target;
  doc: Target & { visibilityState?: string };
  /** 手机 / 平板（主要输入是触摸）：后台时暂停声音、手势里预热语音合成 */
  isTouch: () => boolean;
}

/** 这个事件是否真的能让浏览器允许播放声音 */
export function isActivation(e: Event): boolean {
  if (e.type === 'pointerdown') return (e as PointerEvent).pointerType === 'mouse' || !(e as PointerEvent).pointerType;
  if (e.type === 'keydown') return (e as KeyboardEvent).key !== 'Escape';
  return true;
}

let installed: (() => void) | null = null;

/** 注册一次；重复调用直接返回同一个清理函数（不会出现“点一下响两声”） */
export function installAudioLifecycle(env: AudioLifecycleEnv): () => void {
  if (installed) return installed;
  const { win, doc, isTouch } = env;
  sound.prepare();
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const onGesture: Listener = (e) => {
    if (!isActivation(e)) return;
    sound.unlock();
    sound.startMusic();
    if (isTouch()) voice.prime();
  };
  const onHide = () => {
    if (!isTouch()) return;
    sound.suspendForBackground();
    voice.stop();
  };
  const onShow = () => sound.resumeForForeground();
  const onVisibility = () => (doc.visibilityState === 'hidden' ? onHide() : onShow());
  const onPageShow = () => {
    if (doc.visibilityState !== 'hidden') onShow();
  };
  for (const t of ACTIVATION_EVENTS) win.addEventListener(t, onGesture, opts);
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onHide);
  win.addEventListener('pageshow', onPageShow);
  // 全部静音同步给角色语音（音乐 / 音效由 sound.applyVolumes 处理）
  voice.setMuted(useSettings.getState().muted);
  // 角色说话时压低背景音乐与环境声（倍率见 sound.ts 的 VOICE_DUCK）
  voice.onActiveChange = (on) => sound.setVoiceDuck(on);
  const unsubMute = useSettings.subscribe((s) => voice.setMuted(s.muted));
  installed = () => {
    for (const t of ACTIVATION_EVENTS) win.removeEventListener(t, onGesture, opts);
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', onHide);
    win.removeEventListener('pageshow', onPageShow);
    unsubMute();
    voice.onActiveChange = null;
    sound.setVoiceDuck(false);
    installed = null;
  };
  return installed;
}

/** 浏览器里的默认环境 */
export function browserAudioEnv(): AudioLifecycleEnv | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return { win: window, doc: document, isTouch: isTouchPrimary };
}

const env = browserAudioEnv();
if (env) {
  const dispose = installAudioLifecycle(env);
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
