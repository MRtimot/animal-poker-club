// 俱乐部补给的次数限制（服务器、本地游客、测试共用）。
// - 钱包补给（单人桌的持久金币 / 账号虚拟筹码低于最低下注时免费补到 500）：每天 3 次，21 点与百家乐共用。
//   “一天”按 UTC+8（马来西亚 / 新加坡 / 北京时间）0 点换日：服务器与所有设备算出的日期一样，改手机时区也不会多领。
// - 在线房间的桌上筹码：每个房间里每名玩家最多补充 3 次（桌上筹码不会带回钱包）。
// 只是虚拟筹码，没有真钱。

export const REFILLS_PER_DAY = 3;
export const ROOM_REBUYS = 3;

/** 补给日期（UTC+8），例如 '2026-11-27' */
export function refillDay(now = Date.now()): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}

export interface RefillUse {
  day: string;
  used: number;
}

/** 今天还能领几次 */
export function refillsLeft(u: RefillUse | null | undefined, now = Date.now()): number {
  if (!u || u.day !== refillDay(now)) return REFILLS_PER_DAY;
  return Math.max(0, REFILLS_PER_DAY - Math.max(0, Math.floor(u.used)));
}

/** 用掉一次：返回新的记录；今天已经用完时返回 null */
export function takeRefill(u: RefillUse | null | undefined, now = Date.now()): RefillUse | null {
  if (refillsLeft(u, now) <= 0) return null;
  const day = refillDay(now);
  return { day, used: u && u.day === day ? Math.max(0, Math.floor(u.used)) + 1 : 1 };
}

/** 存档里读到的记录（格式不对就当没有） */
export function cleanRefillUse(x: unknown): RefillUse | null {
  if (!x || typeof x !== 'object') return null;
  const { day, used } = x as Record<string, unknown>;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof used !== 'number' || !Number.isFinite(used)) return null;
  return { day, used: Math.min(REFILLS_PER_DAY, Math.max(0, Math.floor(used))) };
}

export const REFILL_USED_UP = `今天的 ${REFILLS_PER_DAY} 次俱乐部补给已经用完，明天 0 点（马来西亚时间）恢复`;
export const ROOM_REBUYS_USED_UP = `这个房间里的 ${ROOM_REBUYS} 次补充筹码已经用完`;
