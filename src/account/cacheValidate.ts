// 本机的账号离线缓存（apc-account-cache）只用于网络断开时显示，关键数据始终以服务器为准。
// 缓存可能损坏或被手动修改：结构不对就丢弃，而不是让登录流程在显示缓存时崩溃。
import type { AccountState } from '../core/account/types';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

export function parseAccountCache(raw: string | null | undefined): AccountState | null {
  if (!raw) return null;
  let a: unknown;
  try {
    a = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(a)) return null;
  const ok =
    typeof a.nickname === 'string' &&
    (a.avatarUrl === null || a.avatarUrl === undefined || typeof a.avatarUrl === 'string') &&
    typeof a.onboarded === 'boolean' &&
    isObj(a.animal) &&
    Array.isArray(a.characters) &&
    a.characters.every(isObj) &&
    isNum(a.level) &&
    isNum(a.xp) &&
    isNum(a.chips) &&
    isObj(a.stats) &&
    isObj(a.achievements) &&
    Array.isArray(a.unlockedAnimals) &&
    isObj(a.settings) &&
    Array.isArray(a.recent) &&
    a.recent.every(isObj) &&
    isNum(a.version);
  return ok ? (a as unknown as AccountState) : null;
}
