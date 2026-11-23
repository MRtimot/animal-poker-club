// 一键创建房间（电脑版首页的“创建房间”入口）
// 不另起一套房间系统：使用现有的在线房间流程（客户端只发送“创建房间”，服务器生成房间代码与房主 → 自动进入房间大厅）。
// 这里只记录这次请求的状态（正在创建 / 失败），离开首页再回来也能显示正确的状态；
// 入口显示什么由 roomCtaState() 根据真实的房间 / 连接状态决定（已在房间里就“返回房间”，不会再创建第二个）。
import { create } from 'zustand';
import { BLIND_OPTIONS, type RoomInfo, type RoomSettings } from '../core/protocol';
import { useGame, type ConnStatus } from '../store/gameStore';
import { net } from './netClient';

export type QuickRoomRequest = { phase: 'idle' } | { phase: 'creating'; since: number } | { phase: 'error'; message: string };

export const useQuickRoom = create<QuickRoomRequest>()(() => ({ phase: 'idle' }));

/** 与“在线房间”页面的默认设置相同：6 人、1,000 筹码、最低盲注、每次行动 30 秒（房间大厅里可以添加 AI） */
export const QUICK_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 6,
  startingChips: 1000,
  smallBlind: BLIND_OPTIONS[0][0],
  bigBlind: BLIND_OPTIONS[0][1],
  turnSeconds: 30,
};

/** 创建房间。正在创建时再次调用不会发出第二个请求 */
export async function quickCreateRoom(timeoutMs?: number): Promise<void> {
  if (useQuickRoom.getState().phase === 'creating') return;
  useQuickRoom.setState({ phase: 'creating', since: Date.now() });
  const r = await net.requestCreateRoom(QUICK_ROOM_SETTINGS, timeoutMs);
  if (r.ok) {
    useQuickRoom.setState({ phase: 'idle' });
    useGame.getState().toast(`房间已创建 · ${r.code}，把房间代码发给朋友吧`, 'success');
    return;
  }
  useQuickRoom.setState({ phase: 'error', message: r.message });
  // 失败后仍在首页：首页不保持多人连接（不在后台一直重试）
  if (useGame.getState().screen === 'home') net.releaseIfIdle();
}

// 失败提示不应该一直留着：进入了房间，或者离开首页后再回来时，恢复为“创建房间”
useGame.subscribe((s, prev) => {
  if (useQuickRoom.getState().phase !== 'error') return;
  if ((s.room && !prev.room) || (s.screen === 'home' && prev.screen !== 'home')) useQuickRoom.setState({ phase: 'idle' });
});

export type RoomCtaState =
  | { kind: 'create' }
  | { kind: 'creating'; conn: ConnStatus }
  | { kind: 'error'; message: string }
  | { kind: 'lobby'; code: string }
  | { kind: 'game'; code: string | null }
  | { kind: 'reconnect'; code: string; conn: ConnStatus };

/**
 * 入口当前应该显示的状态（只看真实状态，不猜测）：
 * 已在房间大厅 → 返回房间；牌局进行中 → 返回牌桌；正在创建 → 正在创建；
 * 刷新后正在回到原来的房间 → 重新连接；上次创建失败 → 重试；其他 → 创建房间。
 */
export function roomCtaState(i: {
  room: RoomInfo | null;
  mode: 'local' | 'online' | null;
  hasView: boolean;
  lastRoom: string | null;
  conn: ConnStatus;
  request: QuickRoomRequest;
}): RoomCtaState {
  if (i.room && !i.room.solo) return i.room.status === 'lobby' ? { kind: 'lobby', code: i.room.code } : { kind: 'game', code: i.room.code };
  if ((i.room?.solo || i.mode === 'local') && i.hasView) return { kind: 'game', code: null };
  if (i.request.phase === 'creating') return { kind: 'creating', conn: i.conn };
  // 刷新前在房间里、正在重新连接：不要创建新房间（会离开原来的座位）
  if (i.lastRoom && i.conn !== 'idle') return { kind: 'reconnect', code: i.lastRoom, conn: i.conn };
  if (i.request.phase === 'error') return { kind: 'error', message: i.request.message };
  return { kind: 'create' };
}
