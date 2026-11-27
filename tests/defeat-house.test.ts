// 全局结果 → 失败演出：21 点、百家乐与德州使用同一套标准（输光 = 完整处决；一局输掉一半以上 = 简短版；
// 普通输一局 / 打平 / 和局退回 / 赢 = 不演）；输家是自己，赢家是动物庄家（庄家不会被处决）
import { describe, expect, it } from 'vitest';
import { HOUSE_HEAVY_MIN_BETS, verdictOf } from '../src/animation/defeat/defeatRules';
import { HOUSE_WINNER_ID, baccaratOutcome, baccaratStage, blackjackOutcome, blackjackStage } from '../src/animation/defeat/houseResult';
import type { BaccaratView } from '../src/core/baccarat/types';
import type { BlackjackView } from '../src/core/blackjack/types';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';

const prof = (name: string) => ({ name, animal: DEFAULT_ANIMAL, level: 1 });
const rules = { minBet: 10, maxBet: 500 };

function bac(me: { balance: number; bets: [number, number, number]; returns: [number, number, number] | null; placed?: boolean }, winner: 'player' | 'banker' | 'tie' = 'banker'): BaccaratView {
  const b = (x: [number, number, number]) => ({ player: x[0], banker: x[1], tie: x[2] });
  return {
    kind: 'baccarat',
    viewerId: 'me',
    round: 3,
    roundId: 'r3',
    phase: 'round-end',
    rules,
    result: { winner, player: 4, banker: 7 },
    dealer: { profile: prof('狮子'), trait: '' },
    nextRoundAt: null,
    players: [
      { id: 'me', profile: prof('我'), isAI: false, left: false, balance: me.balance, placed: me.placed ?? true, bets: b(me.bets), returns: me.returns ? b(me.returns) : null },
      { id: 'ai0', profile: prof('猫'), isAI: true, aiPersonality: 'smartCat', left: false, balance: 400, placed: true, bets: b([0, 20, 0]), returns: b([0, 39, 0]) },
    ],
  } as unknown as BaccaratView;
}

function bj(me: { balance: number; hands: { bet: number; payout: number; result: string }[] }): BlackjackView {
  return {
    kind: 'blackjack',
    viewerId: 'me',
    round: 5,
    roundId: 'b5',
    rules,
    dealer: { profile: prof('老虎') },
    nextRoundAt: null,
    players: [{ id: 'me', profile: prof('我'), isAI: false, left: false, balance: me.balance, hands: me.hands.map((h, i) => ({ id: 'h' + i, cards: [], value: 18, ...h })) }],
  } as unknown as BlackjackView;
}

describe('全局结果 → 失败演出（21 点 / 百家乐）', () => {
  it('DEFH-01 共用标准：输光 = 完整版；输掉一半以上且至少 10 个最低下注 = 简短版；其余不演', () => {
    expect(verdictOf({ lost: 100, startStack: 100, busted: true, heavyMin: 100 })).toEqual({ cut: 'full', lost: 100, ratio: 1 });
    expect(verdictOf({ lost: 300, startStack: 500, busted: false, heavyMin: 100 })).toEqual({ cut: 'short', lost: 300, ratio: 0.6 });
    expect(verdictOf({ lost: 60, startStack: 100, busted: false, heavyMin: 100 })).toBeNull(); // 比例够，但金额太小
    expect(verdictOf({ lost: 200, startStack: 500, busted: false, heavyMin: 100 })).toBeNull(); // 金额够，但不到一半
    expect(verdictOf({ lost: 0, startStack: 500, busted: true, heavyMin: 100 })).toBeNull(); // 没有输（例如本来就没钱、这局打平）
    expect(HOUSE_HEAVY_MIN_BETS).toBe(10);
  });

  it('DEFH-02 百家乐：押庄 / 押闲输光 → 完整处决；大输 → 简短版；小输不演', () => {
    // 押闲 100 输掉，剩 5（不够最低下注 10）
    expect(verdictOf(baccaratOutcome(bac({ balance: 5, bets: [100, 0, 0], returns: [0, 0, 0] }))!)).toMatchObject({ cut: 'full', lost: 100 });
    // 300 / 500 输掉
    expect(verdictOf(baccaratOutcome(bac({ balance: 200, bets: [300, 0, 0], returns: [0, 0, 0] }))!)).toMatchObject({ cut: 'short', lost: 300 });
    // 押 50 输掉，还剩 450
    expect(verdictOf(baccaratOutcome(bac({ balance: 450, bets: [50, 0, 0], returns: [0, 0, 0] }))!)).toBeNull();
  });

  it('DEFH-03 百家乐：开和时押闲 / 押庄退回 → 没有输家；赢 / 两边都押净赢 / 没下注 → 不演', () => {
    expect(verdictOf(baccaratOutcome(bac({ balance: 5, bets: [100, 100, 0], returns: [100, 100, 0] }, 'tie'))!)).toBeNull();
    expect(verdictOf(baccaratOutcome(bac({ balance: 5, bets: [0, 0, 10], returns: [0, 0, 90] }, 'tie'))!)).toBeNull();
    expect(verdictOf(baccaratOutcome(bac({ balance: 195, bets: [0, 100, 0], returns: [0, 195, 0] }))!)).toBeNull();
    expect(baccaratOutcome(bac({ balance: 5, bets: [0, 0, 0], returns: null, placed: false }))).toBeNull();
    // 押闲 100、押和 20，开庄：净输 120
    expect(baccaratOutcome(bac({ balance: 0, bets: [100, 0, 20], returns: [0, 0, 0] }))).toMatchObject({ lost: 120, startStack: 120, busted: true });
  });

  it('DEFH-04 21 点：爆牌 / 庄家赢输光 → 完整版；平局 → 不演；赢 → 不演；多手看净输赢', () => {
    expect(verdictOf(blackjackOutcome(bj({ balance: 0, hands: [{ bet: 100, payout: 0, result: 'bust' }] }))!)).toMatchObject({ cut: 'full', lost: 100 });
    expect(verdictOf(blackjackOutcome(bj({ balance: 100, hands: [{ bet: 100, payout: 100, result: 'push' }] }))!)).toBeNull();
    expect(verdictOf(blackjackOutcome(bj({ balance: 300, hands: [{ bet: 100, payout: 200, result: 'win' }] }))!)).toBeNull();
    // 分牌：一手赢 200、一手输 → 净 0
    expect(verdictOf(blackjackOutcome(bj({ balance: 200, hands: [{ bet: 100, payout: 200, result: 'win' }, { bet: 100, payout: 0, result: 'lose' }] }))!)).toBeNull();
    // 加倍输掉 400 / 600
    expect(verdictOf(blackjackOutcome(bj({ balance: 200, hands: [{ bet: 400, payout: 0, result: 'lose' }] }))!)).toMatchObject({ cut: 'short', lost: 400 });
    // 还没结算
    expect(blackjackOutcome(bj({ balance: 200, hands: [{ bet: 100, payout: 0, result: null as unknown as string }] }))).toBeNull();
  });

  it('DEFH-05 舞台：输家是自己，赢家是动物庄家；庄家与同桌动物都在场（转头看向输家）且都有座位', () => {
    const s = baccaratStage(bac({ balance: 5, bets: [100, 0, 0], returns: [0, 0, 0] }));
    expect([s.mode, s.round, s.viewerId]).toEqual(['baccarat', 3, 'me']);
    expect(s.cast.map((c) => c.id)).toEqual(['me', 'ai0', HOUSE_WINNER_ID]);
    expect(s.cast.find((c) => c.id === 'ai0')!.aiPersonality).toBe('smartCat');
    for (const c of s.cast) expect(s.layout.get(c.id)).toBeTruthy();
    const b = blackjackStage(bj({ balance: 0, hands: [{ bet: 100, payout: 0, result: 'bust' }] }));
    expect([b.mode, b.cast.at(-1)!.id, !!b.layout.get(HOUSE_WINNER_ID)]).toEqual(['blackjack-21', HOUSE_WINNER_ID, true]);
  });
});
