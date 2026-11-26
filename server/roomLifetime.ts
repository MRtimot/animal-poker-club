// 在线房间的生命周期（唯一的一处设定）。
// 房间的存在时间与牌局动作、聊天、界面操作无关：只看房间状态、谁在线、以及明确的时间点。
// 可以用环境变量调整（毫秒），例如免费服务器内存紧张时缩短：
//   APC_ROOM_WAITING_TTL_MS   大厅等人最长多久（从进入大厅算起）
//   APC_ROOM_EMPTY_TTL_MS     所有真人都不在线后保留多久
//   APC_ROOM_FINISHED_TTL_MS  比赛结束后保留多久（可以看结果、返回大厅再来一局）
//   APC_ROOM_SEAT_HOLD_MS     大厅里断线玩家的座位保留多久
//   APC_ROOM_HOST_GRACE_MS    房主断线多久后把房主交给在线的玩家
// 注意：房间保存在服务器内存（或 Redis）里。服务器重启 / 重新部署 / 免费实例休眠时，内存里的房间会消失。

const env = (name: string, fallback: number) => {
  const v = typeof process !== 'undefined' ? Number(process.env?.[name]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const MIN = 60_000;

export const ROOM_LIFETIME = {
  waitingMs: env('APC_ROOM_WAITING_TTL_MS', 120 * MIN),
  emptyMs: env('APC_ROOM_EMPTY_TTL_MS', 30 * MIN),
  finishedMs: env('APC_ROOM_FINISHED_TTL_MS', 30 * MIN),
  seatHoldMs: env('APC_ROOM_SEAT_HOLD_MS', 15 * MIN),
  hostGraceMs: env('APC_ROOM_HOST_GRACE_MS', 3 * MIN),
};

/** 共享存储里的记录只是“防止孤儿房间”的兜底：比真正的过期时间多留一点；没有过期时间时用这个 */
export const STORE_SAFETY_MS = 6 * 60 * MIN;
export const STORE_MARGIN_MS = 10 * MIN;
/** 有人在线、但长时间没有任何修改的房间：多久续一次共享存储的有效期 */
export const STORE_REFRESH_MS = 30 * MIN;

export interface LifetimeFields {
  status: 'lobby' | 'playing' | 'finished';
  createdAt?: number;
  /** 进入大厅（创建 / 返回大厅）的时刻；牌局进行中为 null */
  waitingSince?: number | null;
  /** 比赛结束的时刻 */
  finishedAt?: number | null;
  /** 所有真人都不在线的时刻 */
  emptySince: number | null;
}

export type ExpiryReason = 'waiting' | 'finished' | 'empty';

/**
 * 房间什么时候过期（服务器时间）。null = 不会因为时间过期（牌局进行中且有人在线）。
 * 只由明确的时间点计算，不会因为每一次心跳、每一个动作而不停往后推。
 */
export function roomExpiry(r: LifetimeFields, life: { waitingMs: number; emptyMs: number; finishedMs: number }): { at: number; reason: ExpiryReason } | null {
  const c: { at: number; reason: ExpiryReason }[] = [];
  if (r.status === 'lobby' && r.waitingSince) c.push({ at: r.waitingSince + life.waitingMs, reason: 'waiting' });
  if (r.status === 'finished' && r.finishedAt) c.push({ at: r.finishedAt + life.finishedMs, reason: 'finished' });
  if (r.emptySince) c.push({ at: r.emptySince + life.emptyMs, reason: 'empty' });
  if (!c.length) return null;
  return c.reduce((a, b) => (b.at < a.at ? b : a));
}

export const EXPIRY_MESSAGE: Record<ExpiryReason, string> = {
  waiting: '房间等待太久还没开始，已自动关闭。请重新创建房间。',
  finished: '牌局已经结束一段时间，房间已关闭。',
  empty: '房间长时间无人在线，已关闭。',
};
