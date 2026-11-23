// Cookie 与本机存储同意：记录玩家的选择，并真正按选择执行。
//
// 本游戏不使用任何分析、广告或追踪（没有第三方脚本，也不收集统计数据），所以“分析”类别只是如实说明“未使用”。
// 必要类别：登录会话 Cookie（仅登录时）、在线房间的断线重连信息、游戏存档、账号离线缓存、这份同意记录本身。
// 偏好类别（可关闭）：画质、音量、镜头、语音等设置保存在本机（apc-settings）。关闭后设置只在本次打开期间有效，已保存的设置会被删除。
//
// 还没有做出选择时保持原来的行为（设置照常保存在本机），电脑版底部会显示一次说明与选择。
import { create } from 'zustand';
import { safeStorage } from '../utils/format';

export const CONSENT_KEY = 'apc-consent';
/** 存储用途有变化（例如新增类别）时加 1：旧的选择失效，重新询问 */
export const CONSENT_VERSION = 1;
export const SETTINGS_STORAGE_KEY = 'apc-settings';

export interface Consent {
  version: number;
  essential: true;
  preferences: boolean;
  /** 未使用：始终为 false */
  analytics: false;
  timestamp: number;
}

export function parseConsent(raw: string | null | undefined): Consent | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (!c || typeof c !== 'object' || c.version !== CONSENT_VERSION || typeof c.preferences !== 'boolean' || typeof c.timestamp !== 'number') return null;
    return { version: CONSENT_VERSION, essential: true, preferences: c.preferences, analytics: false, timestamp: c.timestamp };
  } catch {
    return null;
  }
}

function read(): Consent | null {
  try {
    return parseConsent(safeStorage()?.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

interface ConsentState {
  consent: Consent | null;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useConsent = create<ConsentState>()((set) => ({
  consent: read(),
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));

/** 是否允许把偏好设置保存在本机（还没选择时：允许，保持原来的行为） */
export function preferencesAllowed(): boolean {
  const c = useConsent.getState().consent;
  return c ? c.preferences : true;
}

type Listener = (c: Consent) => void;
const listeners = new Set<Listener>();
/** 选择变化时通知（例如设置模块：关闭偏好时删除已保存的设置，重新开启时写回当前设置） */
export function onConsentChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveConsent(choice: { preferences: boolean }): Consent {
  const c: Consent = { version: CONSENT_VERSION, essential: true, preferences: choice.preferences, analytics: false, timestamp: Date.now() };
  try {
    safeStorage()?.setItem(CONSENT_KEY, JSON.stringify(c));
  } catch {
    /* 存储不可用（隐私模式）：本次打开期间仍然按选择执行 */
  }
  apply(c);
  return c;
}

function apply(c: Consent) {
  useConsent.setState({ consent: c, settingsOpen: false });
  if (!c.preferences) {
    try {
      safeStorage()?.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  for (const fn of listeners) fn(c);
}

// 其他标签页修改了选择：这里同步
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key !== CONSENT_KEY) return;
    const c = parseConsent(e.newValue);
    if (c) apply(c);
    else useConsent.setState({ consent: null });
  });
}
