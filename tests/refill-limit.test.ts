// 俱乐部补给次数：每天 3 次（UTC+8 换日，21 点与百家乐共用）；游客本机、账号服务器、控制器挂钩
import { describe, expect, it } from 'vitest';
import { REFILLS_PER_DAY, REFILL_USED_UP, cleanRefillUse, refillDay, refillsLeft, takeRefill } from '../src/core/refill';
import { openDatabase } from '../server/db/database';
import { AccountService } from '../server/account/accounts';
import { BaccaratController } from '../src/core/baccarat/controller';
import { BlackjackController } from '../src/core/blackjack/controller';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import { seededRandom } from '../src/core/utils/random';
import { refillCopy } from '../src/ui/common/refill';

const g = globalThis as any;
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
};
g.window ??= globalThis;
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
g.localStorage ??= mem();
g.sessionStorage ??= mem();

// 2026-11-26 23:30（UTC+8）= 15:30 UTC；30 分钟后就是 11-27
const LATE = Date.UTC(2026, 10, 26, 15, 30);
const NEXT = LATE + 30 * 60_000;

describe('补给次数规则', () => {
  it('REF-01 按 UTC+8 0 点换日；一天 3 次，第 4 次不行，第二天恢复', () => {
    expect(refillDay(LATE)).toBe('2026-11-26');
    expect(refillDay(NEXT)).toBe('2026-11-27');
    let u = null as ReturnType<typeof takeRefill>;
    for (let i = 0; i < REFILLS_PER_DAY; i++) {
      expect(refillsLeft(u, LATE)).toBe(REFILLS_PER_DAY - i);
      u = takeRefill(u, LATE);
      expect(u).toEqual({ day: '2026-11-26', used: i + 1 });
    }
    expect(refillsLeft(u, LATE)).toBe(0);
    expect(takeRefill(u, LATE)).toBeNull();
    expect(refillsLeft(u, NEXT)).toBe(3);
    expect(takeRefill(u, NEXT)).toEqual({ day: '2026-11-27', used: 1 });
  });

  it('REF-02 存档里的记录逐项校验：格式不对当作没有，次数封顶', () => {
    expect(cleanRefillUse({ day: '2026-11-26', used: 2 })).toEqual({ day: '2026-11-26', used: 2 });
    expect(cleanRefillUse({ day: '2026-11-26', used: 99 })).toEqual({ day: '2026-11-26', used: 3 });
    expect(cleanRefillUse({ day: '2026-11-26', used: -4 })).toEqual({ day: '2026-11-26', used: 0 });
    for (const bad of [null, 'x', { day: 'today', used: 1 }, { day: '2026-11-26', used: '1' }, { day: '2026-11-26', used: NaN }]) expect(cleanRefillUse(bad)).toBeNull();
  });

  it('REF-03 游客：本机金币每天只能补给 3 次；金币还够时不算次数；用完返回原因、金币不变', async () => {
    const { useProfile } = await import('../src/store/profileStore');
    useProfile.setState({ chips: 0, refills: null });
    const p = () => useProfile.getState();
    expect(p().refillChips(10)).toBe(500);
    expect(p().refillChips(10)).toBe(500); // 还够：不算一次
    expect(p().refillsLeft()).toBe(2);
    for (let i = 0; i < 2; i++) {
      useProfile.setState({ chips: 3 });
      expect(p().refillChips(10)).toBe(500);
    }
    useProfile.setState({ chips: 3 });
    expect(p().refillChips(10)).toBe(REFILL_USED_UP);
    expect([p().chips, p().refillsLeft()]).toEqual([3, 0]);
    // 昨天用完的不影响今天
    useProfile.setState({ refills: { day: '2000-01-01', used: 3 } });
    expect(p().refillsLeft()).toBe(3);
    expect(p().refillChips(10)).toBe(500);
  });

  it('REF-04 账号：服务器在同一个事务里检查并记录次数（数据库第 4 版）；UTC+8 0 点后恢复', () => {
    const db = openDatabase(':memory:');
    const acc = new AccountService(db);
    const { userId } = acc.loginWithIdentity({ provider: 'dev', subject: 'refill' });
    expect((db.prepare('SELECT version FROM schema_meta').get() as { version: number }).version).toBe(4);
    const broke = () => db.prepare('UPDATE player_progress SET virtual_chips = 3 WHERE user_id = ?').run(userId);
    expect(acc.refillChips(userId, 10, 500, LATE)).toBe(acc.chipsOf(userId)); // 还够：不补、不算次数
    expect(acc.refillsLeft(userId, LATE)).toBe(3);
    for (let i = 0; i < 3; i++) {
      broke();
      expect(acc.refillChips(userId, 10, 500, LATE)).toBe(500);
    }
    broke();
    expect(acc.refillChips(userId, 10, 500, LATE)).toBe(REFILL_USED_UP);
    expect([acc.chipsOf(userId), acc.refillsLeft(userId, LATE)]).toEqual([3, 0]);
    expect(acc.refillChips(userId, 10, 500, NEXT)).toBe(500);
    expect(acc.refillsLeft(userId, NEXT)).toBe(2);
  });

  it('REF-05 控制器：挂钩返回的原因原样告诉玩家，余额不变；视图带着剩余次数（21 点、百家乐）', () => {
    const prof = (name: string) => ({ name, animal: DEFAULT_ANIMAL, level: 1 });
    const hooks = { refill: () => REFILL_USED_UP, refillsLeft: () => 0 };
    const bac = new BaccaratController([{ id: 'me', profile: prof('me'), chips: 3, isAI: false }], { solo: true, economy: 'profile', autoRun: false, pace: 1, rng: seededRandom(1), dealer: { profile: prof('庄'), trait: '' } } as any);
    bac.hooks = hooks;
    bac.start();
    for (let i = 0; i < 20 && bac.engine.phase !== 'betting' && bac.nextWakeAt() !== null; i++) bac.tick(bac.nextWakeAt()!);
    expect(bac.handle('me', { type: 'rebuy' }, { round: bac.engine.round })).toBe(REFILL_USED_UP);
    expect([bac.engine.getPlayer('me')!.balance, bac.getView('me').refillsLeft]).toEqual([3, 0]);

    const bj = new BlackjackController([{ id: 'me', profile: prof('me'), chips: 3, isAI: false }], { solo: true, economy: 'profile', autoRun: false, pace: 1, rng: seededRandom(1), dealer: { profile: prof('庄'), trait: '' } } as any);
    bj.hooks = hooks;
    bj.start();
    for (let i = 0; i < 20 && bj.engine.phase !== 'betting' && bj.nextWakeAt() !== null; i++) bj.tick(bj.nextWakeAt()!);
    expect(bj.handle('me', { type: 'rebuy' } as any)).toBe(REFILL_USED_UP);
    expect(bj.getView('me').refillsLeft).toBe(0);
  });

  it('REF-06 补给面板的文字：还剩几次、用完时按钮不可用并说明原因', () => {
    expect(refillCopy({ economy: 'profile', refillsLeft: 2 })).toMatchObject({ canRefill: true, button: '领取俱乐部补给（今天还剩 2 次）' });
    expect(refillCopy({ economy: 'profile', refillsLeft: 0 })).toMatchObject({ canRefill: false });
    expect(refillCopy({ economy: 'table', refillsLeft: 1 })).toMatchObject({ canRefill: true, button: '补充筹码（还剩 1 次）' });
    expect(refillCopy({ economy: 'table', refillsLeft: 0 }).note).toContain('只能旁观');
    expect(refillCopy({ economy: 'table', refillsLeft: null })).toMatchObject({ canRefill: true, note: '' });
  });
});
