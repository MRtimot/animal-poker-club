// 登录状态与云端同步。
// 服务器是唯一可信来源：客户端只发送“玩家修改了昵称 / 外观 / 设置”，从不发送等级、经验或筹码。
import { create } from 'zustand';
import type { AccountSettings, AccountState, ProgressEvent } from '../core/account/types';
import { nicknameError } from '../core/account/types';
import { ACHIEVEMENTS } from '../progress/progression';
import { SPECIES_MAP } from '../core/player/profile';
import { ApiError, accountApi } from '../account/api';
import { clearGuestSave, isAccountMode, readGuestSave, showAccount, showGuest, useProfile } from './profileStore';
import { useSettings } from './settingsStore';
import { useGame } from './gameStore';
import { safeStorage } from '../utils/format';
import { sound } from '../audio/sound';

export type AccountStatus = 'checking' | 'guest' | 'signingIn' | 'loading' | 'signedIn';
export type SyncStatus = 'idle' | 'syncing' | 'saved' | 'retrying' | 'offline';

/** 登录后依次恢复的内容（加载动画） */
export const LOAD_STEPS = ['身份', '玩家资料', '等级', '筹码', '动物', '外观', '成就', '设置', '游戏状态'];

interface AccountStore {
  status: AccountStatus;
  account: AccountState | null;
  /** accounts=false：服务器没有开启账号系统（游客模式，进度只保存在本机） */
  config: { googleClientId: string | null; devLogin: boolean; accounts?: boolean } | null;
  /** 当前显示的是离线缓存（服务器暂时无法连接） */
  cached: boolean;
  sync: SyncStatus;
  loginError: string | null;
  loadStep: number;
  welcome: string | null;
  set: (p: Partial<AccountStore>) => void;
}

export const useAccount = create<AccountStore>()((set) => ({
  status: 'checking',
  account: null,
  config: null,
  cached: false,
  sync: 'idle',
  loginError: null,
  loadStep: -1,
  welcome: null,
  set: (p) => set(p),
}));

const CACHE_KEY = 'apc-account-cache';
const OUTBOX_KEY = 'apc-account-outbox';
const GUEST_OK_KEY = 'apc-guest-ok';

const store = () => safeStorage();
const toast = (t: string, k?: Parameters<ReturnType<typeof useGame.getState>['toast']>[1]) => useGame.getState().toast(t, k);

// ───────────── 本地缓存（只用于离线查看，关键数据始终以服务器为准） ─────────────

function writeCache(a: AccountState | null) {
  try {
    if (a) store()?.setItem(CACHE_KEY, JSON.stringify({ ...a, isNew: undefined }));
    else store()?.removeItem(CACHE_KEY);
  } catch {
    /* 存储空间不足时忽略 */
  }
}

function readCache(): AccountState | null {
  try {
    const raw = store()?.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AccountState) : null;
  } catch {
    return null;
  }
}

export function guestChosen() {
  return store()?.getItem(GUEST_OK_KEY) === '1';
}
export function chooseGuest() {
  store()?.setItem(GUEST_OK_KEY, '1');
}

// ───────────── 应用服务器数据 ─────────────

let applying = false;
const SETTINGS_MAP: (keyof AccountSettings)[] = ['quality', 'autoQuality', 'room', 'musicVolume', 'sfxVolume', 'ambientVolume', 'autoCamera', 'showFps', 'tutorialDone'];

function applyState(a: AccountState) {
  applying = true;
  try {
    useAccount.getState().set({ account: a, cached: false });
    showAccount(a);
    const patch: any = {};
    for (const k of SETTINGS_MAP) if (a.settings[k] !== undefined) patch[k] = a.settings[k];
    // 开启“自动画质”时，画质由每台设备根据自身性能决定（手机降画质不会影响电脑）
    if ((patch.autoQuality ?? useSettings.getState().autoQuality) === true) delete patch.quality;
    if (Object.keys(patch).length) useSettings.getState().set(patch);
    writeCache(a);
  } finally {
    applying = false;
  }
  lastSent = snapshot();
}

// ───────────── 自动保存：修改记录（离线时保存在本机，恢复网络后自动重试） ─────────────

interface Outbox {
  profile?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

let outbox: Outbox = (() => {
  try {
    return JSON.parse(store()?.getItem(OUTBOX_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
})();
let flushing = false;
let retryTimer: number | null = null;
let flushTimer: number | null = null;
let retryCount = 0;
let savedTimer: number | null = null;

function saveOutbox() {
  try {
    if (outbox.profile || outbox.settings) store()?.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    else store()?.removeItem(OUTBOX_KEY);
  } catch {
    /* ignore */
  }
}

function queue(kind: keyof Outbox, patch: Record<string, unknown>, delay = 600) {
  outbox[kind] = { ...(outbox[kind] ?? {}), ...patch };
  saveOutbox();
  scheduleFlush(delay);
}

function scheduleFlush(delay: number) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay);
}

function setSync(s: SyncStatus) {
  useAccount.getState().set({ sync: s });
  if (savedTimer) clearTimeout(savedTimer);
  if (s === 'saved') savedTimer = window.setTimeout(() => useAccount.getState().sync === 'saved' && useAccount.getState().set({ sync: 'idle' }), 2200);
}

/** 把待保存的修改发送到服务器；失败自动重试，冲突时在最新数据上重新应用 */
export async function flush(): Promise<void> {
  if (flushing || useAccount.getState().status !== 'signedIn') return;
  if (!outbox.profile && !outbox.settings) return;
  flushing = true;
  setSync('syncing');
  try {
    for (let guard = 0; guard < 4 && (outbox.profile || outbox.settings); guard++) {
      try {
        if (outbox.profile) {
          const patch = outbox.profile;
          const { state } = await accountApi.patchProfile(patch, useAccount.getState().account?.version);
          if (outbox.profile === patch) delete outbox.profile;
          saveOutbox();
          applyState(state);
        }
        if (outbox.settings) {
          const patch = outbox.settings;
          const { state } = await accountApi.patchSettings(patch);
          if (outbox.settings === patch) delete outbox.settings;
          saveOutbox();
          applyState(state);
        }
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        if (e.status === 409 && e.body?.state) {
          // 其他设备刚刚修改过：先显示最新数据，再把这次的修改应用在最新数据上
          const mine = outbox.profile;
          applyState(e.body.state);
          outbox.profile = mine;
          continue;
        }
        if (e.status === 401) {
          await endSession('登录已过期，请重新登录。你的进度已保存在云端。');
          return;
        }
        if (e.status === 400 || e.status === 403 || e.status === 413) {
          // 服务器拒绝（例如昵称不合规）：放弃这次修改，恢复为服务器上的数据
          delete outbox.profile;
          saveOutbox();
          toast(e.message, 'error');
          const a = useAccount.getState().account;
          if (a) applyState(a);
          continue;
        }
        // 网络断开 / 服务器暂时不可用：稍后自动重试，不丢弃修改
        setSync(e.offline ? 'offline' : 'retrying');
        const delay = Math.min(30000, 1000 * 2 ** retryCount++);
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          void flush();
        }, delay);
        return;
      }
    }
    retryCount = 0;
    setSync('saved');
  } finally {
    flushing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    retryCount = 0;
    void flush();
    if (useAccount.getState().cached) void refresh();
  });
}

// 监听本地修改 → 自动保存（不需要“保存游戏”按钮）
type Snap = { name: string; animal: string; characters: string; created: boolean; settings: string };
function snapshot(): Snap {
  const p = useProfile.getState();
  const s = useSettings.getState() as any;
  return {
    name: p.name,
    animal: JSON.stringify(p.animal),
    characters: JSON.stringify(p.characters),
    created: p.createdCharacter,
    settings: JSON.stringify(SETTINGS_MAP.map((k) => s[k])),
  };
}
let lastSent = snapshot();

function onLocalChange() {
  if (applying || !isAccountMode() || useAccount.getState().status !== 'signedIn') return;
  const now = snapshot();
  const p = useProfile.getState();
  const patch: Record<string, unknown> = {};
  if (now.name !== lastSent.name && !nicknameError(p.name)) patch.nickname = p.name;
  if (now.animal !== lastSent.animal) patch.animal = p.animal;
  if (now.characters !== lastSent.characters) patch.characters = p.characters;
  if (now.created && !lastSent.created) patch.onboarded = true;
  if (Object.keys(patch).length) queue('profile', patch, patch.nickname ? 900 : 400);
  if (now.settings !== lastSent.settings) {
    const s = useSettings.getState() as any;
    queue('settings', Object.fromEntries(SETTINGS_MAP.map((k) => [k, s[k]])), 800);
  }
  lastSent = { ...now, name: patch.nickname || now.name === lastSent.name ? now.name : lastSent.name };
}
useProfile.subscribe(onLocalChange);
useSettings.subscribe(onLocalChange);

// ───────────── 登录流程 ─────────────

let reconnect: (() => void) | null = null;
/** 由网络模块注册：登录状态变化后重新建立 WebSocket，让服务器识别新的身份 */
export function onIdentityChanged(fn: () => void) {
  reconnect = fn;
}

async function loadConfig() {
  try {
    useAccount.getState().set({ config: await accountApi.config() });
  } catch {
    useAccount.getState().set({ config: null });
  }
}

async function refresh() {
  try {
    const { state } = await accountApi.me();
    applyState(state);
    useAccount.getState().set({ status: 'signedIn' });
    void flush();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      if (useAccount.getState().status === 'signedIn') await endSession(null);
      return false;
    }
    return null;
  }
}

/** 打开网站时：先显示离线缓存，再向服务器确认登录状态并恢复最新数据 */
export async function initAccount() {
  await loadConfig();
  const cfg = useAccount.getState().config;
  if (cfg && cfg.accounts === false) {
    // 服务器只提供游客模式：不请求任何账号接口
    writeCache(null);
    useAccount.getState().set({ status: 'guest' });
    return;
  }
  const cache = readCache();
  if (cache) {
    applying = true;
    showAccount(cache);
    applying = false;
    useAccount.getState().set({ status: 'signedIn', account: cache, cached: true });
  }
  const ok = await refresh();
  if (ok === null) {
    // 服务器暂时无法连接
    if (cache) {
      useAccount.getState().set({ cached: true, sync: 'offline' });
      toast('服务器暂时无法同步你的资料，正在显示离线缓存。', 'error');
    } else useAccount.getState().set({ status: 'guest' });
  } else if (ok === false) {
    useAccount.getState().set({ status: 'guest' });
  }
}

function meaningfulGuest(g: any) {
  return !!g && ((g.stats?.handsPlayed ?? 0) > 0 || g.createdCharacter || (g.characters?.length ?? 0) > 0 || (g.xp ?? 0) > 0);
}

async function afterLogin(first: AccountState) {
  const A = useAccount.getState();
  A.set({ status: 'loading', loadStep: 0, loginError: null });
  let state = first;
  // 游客进度迁移
  const guest = readGuestSave();
  if (meaningfulGuest(guest)) {
    try {
      const s = useSettings.getState();
      const r = await accountApi.migrateGuest({ ...guest, settings: Object.fromEntries(SETTINGS_MAP.map((k) => [k, (s as any)[k]])) });
      state = { ...r.state, isNew: first.isNew };
      clearGuestSave();
      toast(r.migrated ? '✅ 游戏进度已保存' : '这个账号已经合并过游客进度，本次游客进度未合并', r.migrated ? 'success' : 'info');
    } catch {
      toast('游客进度暂时无法上传，稍后登录时会再次尝试', 'error');
    }
  } else if (Object.keys(first.settings).length === 0) {
    // 新账号：把本机的偏好设置保存到云端
    const s = useSettings.getState() as any;
    outbox.settings = Object.fromEntries(SETTINGS_MAP.map((k) => [k, s[k]]));
    saveOutbox();
  }
  applyState(state);
  A.set({ status: 'signedIn' });
  reconnect?.();
  void flush();
  // 依次恢复：身份 → 资料 → 等级 → 筹码 → 动物 → 外观 → 成就 → 设置 → 游戏状态
  for (let i = 1; i <= LOAD_STEPS.length; i++) {
    await new Promise((r) => setTimeout(r, 150));
    useAccount.getState().set({ loadStep: i });
  }
  await new Promise((r) => setTimeout(r, 250));
  const g = useGame.getState();
  if (!state.onboarded) {
    useAccount.getState().set({ loadStep: -1 });
    g.setScreen('onboarding');
  } else {
    useAccount.getState().set({ loadStep: -1, welcome: `欢迎回来，${state.nickname}` });
    g.setScreen('home');
    setTimeout(() => useAccount.getState().set({ welcome: null }), 3600);
  }
}

function loginFailed(e: unknown) {
  const msg = e instanceof ApiError && (e.status === 429 || e.status === 503) ? e.message : '登录失败，请重新尝试。';
  useAccount.getState().set({ status: 'guest', loginError: msg, loadStep: -1 });
  if (import.meta.env.DEV) console.warn('[登录] 失败', e);
}

/** 服务器是否提供登录（云端存档） */
export function accountsAvailable() {
  const c = useAccount.getState().config;
  return !!c && c.accounts !== false && (!!c.googleClientId || c.devLogin);
}

export async function signInWithGoogle(credential: string) {
  useAccount.getState().set({ status: 'signingIn', loginError: null });
  try {
    const { state } = await accountApi.google(credential);
    await afterLogin(state);
  } catch (e) {
    loginFailed(e);
  }
}

/** 开发环境测试登录（正式环境服务器不提供此接口） */
export async function signInDev(name: string) {
  useAccount.getState().set({ status: 'signingIn', loginError: null });
  try {
    const { state } = await accountApi.dev(name);
    await afterLogin(state);
  } catch (e) {
    loginFailed(e);
  }
}

/** 清除本机登录状态（云端数据保持不变） */
async function endSession(message: string | null) {
  outbox = {};
  saveOutbox();
  writeCache(null);
  useAccount.getState().set({ status: 'guest', account: null, cached: false, sync: 'idle' });
  await showGuest();
  lastSent = snapshot();
  reconnect?.();
  if (message) toast(message, 'info');
}

export async function signOut() {
  // 先尽量把还没保存的修改发出去
  try {
    await flush();
  } catch {
    /* ignore */
  }
  try {
    await accountApi.logout();
  } catch {
    /* 即使网络断开，本机的登录状态也会被清除 */
  }
  await endSession('已退出登录。你的游戏进度已安全保存在云端。');
  useGame.getState().setScreen('home');
}

let deleting = false;
export async function deleteAccount(): Promise<boolean> {
  deleting = true;
  try {
    await accountApi.deleteAccount();
  } catch (e) {
    toast(e instanceof ApiError ? e.message : '删除失败，请稍后再试', 'error');
    return false;
  } finally {
    deleting = false;
  }
  await endSession('账号与所有游戏数据已删除。');
  useGame.getState().setScreen('home');
  return true;
}

/**
 * 直接向服务器提交档案修改并等待结果（用于首次创建档案、修改昵称，需要立即知道是否通过校验）。
 * 返回 null 表示成功，否则返回中文错误提示。
 */
export async function submitProfile(patch: Record<string, unknown>): Promise<string | null> {
  const local = patch.nickname !== undefined ? nicknameError(patch.nickname) : null;
  if (local) return local;
  // 先把排队中的修改发出去，避免版本号冲突
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
  for (let i = 0; i < 3; i++) {
    try {
      setSync('syncing');
      const { state } = await accountApi.patchProfile(patch, useAccount.getState().account?.version);
      applyState(state);
      setSync('saved');
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.state) {
        applyState(e.body.state);
        continue;
      }
      setSync('idle');
      if (e instanceof ApiError && e.offline) return '网络连接失败，请检查网络后重试';
      return e instanceof ApiError ? e.message : '保存失败，请稍后再试';
    }
  }
  return '保存失败，请稍后再试';
}

// ───────────── 服务器推送 ─────────────

/** 账号在其他设备上被修改：直接显示最新数据 */
export function onServerAccount(state: AccountState | null) {
  const A = useAccount.getState();
  if (A.status === 'checking' || A.status === 'signingIn' || A.status === 'loading') return;
  if (!state) {
    // 本机正在删除账号时，服务器的推送不需要重复提示
    if (A.status === 'signedIn' && !deleting) void endSession('账号已在其他设备上删除。');
    return;
  }
  if (A.status !== 'signedIn') return;
  // 本机还有未保存的修改时，不用服务器数据覆盖（保存成功后会自动对齐）
  if (outbox.profile) {
    useAccount.getState().set({ account: { ...state } });
    return;
  }
  applyState(state);
}

/** 服务器结算后的奖励：经验、筹码、升级、成就与解锁 */
export function onServerProgress(event: ProgressEvent, state: AccountState) {
  if (useAccount.getState().status !== 'signedIn') return;
  const before = useAccount.getState().account;
  if (outbox.profile) useAccount.getState().set({ account: state });
  else applyState(state);
  if (!outbox.profile) setSync('saved');
  for (const id of event.newAchievements) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a) toast(`${a.icon} 达成成就：${a.name}`, 'unlock');
  }
  if (event.levelAfter > event.levelBefore) toast(`🎉 升级！你现在是 ${event.levelAfter} 级`, 'unlock');
  for (const sp of event.newAnimals) toast(`${SPECIES_MAP[sp].emoji} 解锁新动物：${SPECIES_MAP[sp].name}！`, 'unlock');
  if (event.chipsGained > 0 && before) toast(`🪙 获得 ${event.chipsGained.toLocaleString('en-US')} 虚拟筹码`, 'success');
  if (event.newAchievements.length || event.levelAfter > event.levelBefore || event.newAnimals.length) sound.play('unlock', 0.6);
}

export function isSignedIn() {
  return useAccount.getState().status === 'signedIn';
}
