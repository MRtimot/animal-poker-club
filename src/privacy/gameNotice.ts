// 游戏说明（Game Notice）：第一次进入首页 / 模式选择时显示一次，说明这是一款虚拟娱乐游戏。
//
// 这不是用户协议、隐私政策或任何法律同意：只记录“玩家已经看过并点了继续”，以后不再自动弹出。
// 保存在本机（apc-game-notice），与 Cookie 选择（apc-consent）一样属于“必要”存储：
// 不受“偏好设置”开关影响，否则选择“仅必要”的玩家每次打开都会再看到一次。
//
// 存档字段：gameNoticeAcknowledged: boolean
//   旧玩家 / 新玩家没有这个字段 → undefined → false → 显示一次
//   点“继续” → true → 以后不再显示
// 存储不可用（隐私模式）时：本次打开期间记住，不会在同一次打开里重复弹出。
//
// 显示时机：加载页完全退场之后（markLoaderGone），绝不阻塞加载。
import { create } from 'zustand';
import { safeStorage } from '../utils/format';

export const GAME_NOTICE_KEY = 'apc-game-notice';
/** 说明内容有实质变化时加 1：旧的确认失效，重新显示一次 */
export const GAME_NOTICE_VERSION = 1;

export interface GameNoticeSave {
  version: number;
  gameNoticeAcknowledged: boolean;
  timestamp: number;
}

/** 读取存档；缺字段、损坏、版本不同都按“还没确认”（false）处理，不会抛错 */
export function parseGameNotice(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const v = JSON.parse(raw);
    return !!v && typeof v === 'object' && v.version === GAME_NOTICE_VERSION && v.gameNoticeAcknowledged === true;
  } catch {
    return false;
  }
}

function read(): boolean {
  try {
    return parseGameNotice(safeStorage()?.getItem(GAME_NOTICE_KEY));
  } catch {
    return false;
  }
}

interface GameNoticeState {
  acknowledged: boolean;
  /** 加载页已经完全退场（说明只在这之后出现） */
  loaderGone: boolean;
}

export const useGameNotice = create<GameNoticeState>()(() => ({
  acknowledged: read(),
  loaderGone: false,
}));

export function markLoaderGone() {
  if (!useGameNotice.getState().loaderGone) useGameNotice.setState({ loaderGone: true });
}

export function acknowledgeGameNotice() {
  const save: GameNoticeSave = { version: GAME_NOTICE_VERSION, gameNoticeAcknowledged: true, timestamp: Date.now() };
  try {
    safeStorage()?.setItem(GAME_NOTICE_KEY, JSON.stringify(save));
  } catch {
    /* 存储不可用：本次打开期间仍然记住 */
  }
  useGameNotice.setState({ acknowledged: true });
}

/** 显示说明的页面：首页与模式选择（以及在线房间入口）。牌局、房间、登录、建角色时不打断 */
export const NOTICE_SCREENS = ['home', 'quick', 'online'] as const;

export function shouldShowGameNotice(s: { acknowledged: boolean; loaderGone: boolean }, screen: string): boolean {
  return !s.acknowledged && s.loaderGone && (NOTICE_SCREENS as readonly string[]).includes(screen);
}

// 另一个标签页点了继续：这里同步关闭
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === GAME_NOTICE_KEY) useGameNotice.setState({ acknowledged: parseGameNotice(e.newValue) });
  });
}
