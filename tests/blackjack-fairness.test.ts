// 21 点公平性：发牌只由随机数决定；大量模拟逐局核对；没有任何依据玩家情况调整牌的代码路径
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlackjackEngine } from '../src/core/blackjack/engine';
import { CHI_LIMIT, simulate } from '../src/core/blackjack/simulate';
import { dealerRuleProblem, expectedPayout, expectedResult, handProblem, validCard } from '../src/core/blackjack/audit';
import { blackjackRates, blackjackWinRate, EMPTY_BLACKJACK } from '../src/progress/blackjackStats';
import { applyBlackjackRound } from '../src/progress/rewards';
import { normalizeStats } from '../src/progress/progression';
import { parseCards } from '../src/core/cards/card';
import { seededRandom } from '../src/core/utils/random';

const cards = (s: string) => parseCards(s);

describe('21 点公平性', () => {
  it('FAIR-01 发出的牌只取决于随机数：玩家名字、余额、下注、打法、输赢历史完全不同，牌序一模一样', () => {
    const play = (name: string, balance: number, bet: number, act: 'hit' | 'stand') => {
      const e = new BlackjackEngine({ minBet: 1, maxBet: 1_000_000 }, seededRandom(77));
      e.addPlayer(name, name, balance);
      const orders: string[] = [];
      const results: string[] = [];
      for (let r = 0; r < 300; r++) {
        e.openBetting();
        e.placeBet(name, Math.min(bet, e.getPlayer(name)!.balance) || 1);
        orders.push(JSON.stringify(e.toState().shoe.order));
        e.deal();
        e.beginTurns();
        while (e.phase === 'player-turn') e.act(name, act);
        while (e.phase === 'dealer-turn') e.dealerStep();
        results.push(e.getPlayer(name)!.hands.map((h) => h.result).join());
        if (e.getPlayer(name)!.balance < 1) e.setBalance(name, balance);
      }
      return { orders, results };
    };
    const a = play('穷玩家', 50, 1, 'stand');
    const b = play('VIP 大户', 1e9, 500_000, 'hit');
    expect(a.orders).toEqual(b.orders);
    expect(a.results).not.toEqual(b.results); // 打法不同，结果自然不同
  });

  it('FAIR-02 牌组模块只依赖牌与随机数（读不到玩家、下注、余额、等级、动物、连胜连败）', () => {
    const src = fs.readFileSync(new URL('../src/core/blackjack/shoe.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['../cards/physical', '../utils/random']);
    const engine = fs.readFileSync(new URL('../src/core/blackjack/engine.ts', import.meta.url), 'utf8');
    // 引擎只在三个地方碰牌组：新的一局、发一张、保存 / 恢复
    const uses = [...engine.matchAll(/this\.shoe\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(uses)].sort()).toEqual(['draw', 'newRound', 'remaining', 'size', 'toState']);
    for (const f of ['shoe.ts', 'engine.ts', 'hand.ts', 'rules.ts']) {
      const s = fs.readFileSync(new URL('../src/core/blackjack/' + f, import.meta.url), 'utf8');
      expect(s).not.toMatch(/Math\.random|streak|pity|lossStreak|winStreak|vip|luck/i);
    }
  });

  it('FAIR-03 20,000 局（1 人）逐局核对：没有重复 / 无效的牌、错误结果、错误赔付、违规动作、重复派彩；分布没有明显偏差', () => {
    const r = simulate({ rounds: 20_000, rng: seededRandom(2026) });
    expect(r.problems).toEqual([]);
    expect(r.chiRank).toBeLessThan(CHI_LIMIT.rank);
    expect(r.chiSuit).toBeLessThan(CHI_LIMIT.suit);
    expect(r.chiUpCard).toBeLessThan(CHI_LIMIT.upCard);
    // 单副牌、基本策略的数学范围（只用于发现明显错误，不是目标值）
    expect(r.rate.blackjack).toBeGreaterThan(0.04);
    expect(r.rate.blackjack).toBeLessThan(0.055);
    expect(r.rate.dealerBust).toBeGreaterThan(0.2); // 按全部局数（玩家先爆牌时庄家不补牌）
    expect(r.rate.dealerBust).toBeLessThan(0.3);
    expect(Math.abs(r.houseEdge)).toBeLessThan(0.03);
  }, 60_000);

  it('FAIR-04 6 人同桌 3,000 局（使用真正的加密随机数）逐局核对', () => {
    const r = simulate({ rounds: 3000, players: 6 });
    expect(r.problems).toEqual([]);
    expect(r.hands).toBeGreaterThan(18_000);
  }, 60_000);

  it('FAIR-05 核对工具本身：能发现错误的结果、赔付、庄家动作与手牌', () => {
    expect(expectedResult(cards('As Kd'), false, cards('Ts 6d 5c'))).toBe('blackjack');
    expect(expectedResult(cards('As Kd'), true, cards('Ts 6d 5c'))).toBe('push');
    expect(expectedResult(cards('Ts 8d 5c'), false, cards('Ts 6d 9c'))).toBe('bust');
    expect([expectedPayout(100, 'blackjack'), expectedPayout(100, 'win'), expectedPayout(100, 'push'), expectedPayout(100, 'lose')]).toEqual([250, 200, 100, 0]);
    expect(dealerRuleProblem(cards('As 6d 2c'), true)).toMatch('17 点还在要牌');
    expect(dealerRuleProblem(cards('Ts 6d'), true)).toMatch('16 点就停牌');
    expect(dealerRuleProblem(cards('Ts 6d 4c'), false)).toMatch('庄家却补了牌');
    expect(dealerRuleProblem(cards('As 6d'), true)).toBeNull();
    expect(handProblem({ cards: cards('Ts 8d 5c 2h'), doubled: false, fromSplit: false }, 1)).toMatch('还在拿牌');
    expect(handProblem({ cards: cards('5s 6d 9c 2h'), doubled: true, fromSplit: false }, 1)).toMatch('加倍');
    expect(validCard({ id: 'As', rank: 14, suit: 's', uid: 'As-0' })).toBe(true);
    expect(validCard({ id: 'As', rank: 13, suit: 's', uid: 'As-0' })).toBe(false);
  });

  it('FAIR-06 胜率 = 赢 ÷（赢 + 输），平局不算；胜率与净输赢分开', () => {
    expect(blackjackWinRate({ ...EMPTY_BLACKJACK, rounds: 100, wins: 40, losses: 50, pushes: 10 })).toBe('44.4%');
    expect(blackjackWinRate(EMPTY_BLACKJACK)).toBe('—');
    // 10 赢 10 输：胜率 50%，但赢的都是加倍，净赚
    let s = normalizeStats({});
    for (let i = 0; i < 10; i++) s = applyBlackjackRound(s, { roundId: 'w' + i, bet: 200, payout: 400, profit: 200, hands: [{ result: 'win', value: 20, cards: 3, doubled: true, fromSplit: false }], dealerBust: i < 3 }).stats;
    for (let i = 0; i < 10; i++) s = applyBlackjackRound(s, { roundId: 'l' + i, bet: 100, payout: 0, profit: -100, hands: [{ result: 'lose', value: 18, cards: 2, doubled: false, fromSplit: false }] }).stats;
    expect(blackjackRates(s.blackjack)).toMatchObject({ winRate: '50.0%', pushRate: '0.0%', dealerBustRate: '15.0%', profit: 1000 });
  });
});
