// 百家乐公平性：发牌只由随机数决定；大量模拟逐局核对；牌组模块读不到任何玩家信息
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BaccaratEngine } from '../src/core/baccarat/engine';
import { BAC_CHI_LIMIT, BAC_THEORY, simulateBaccarat } from '../src/core/baccarat/simulate';
import { expectedCardCounts, expectedReturns } from '../src/core/baccarat/audit';
import { parseCards } from '../src/core/cards/card';
import { seededRandom } from '../src/core/utils/random';

describe('百家乐公平性', () => {
  it('BACF-01 发出的牌只取决于随机数：名字、余额、下注区、下注金额、输赢历史完全不同，每一局的牌一模一样', () => {
    const play = (name: string, balance: number, pick: (r: number) => Record<string, number>) => {
      const e = new BaccaratEngine({ minBet: 1, maxBet: 1_000_000 }, seededRandom(99));
      e.addPlayer(name, name, balance);
      const coups: string[] = [];
      for (let r = 0; r < 500; r++) {
        e.openBetting();
        if (e.getPlayer(name)!.balance < 10) e.setBalance(name, balance);
        e.placeBet(name, pick(r));
        e.closeBetting();
        while (e.hasMoreCards()) e.revealNext();
        e.resolve();
        coups.push(JSON.stringify(e.coup));
      }
      return coups;
    };
    const a = play('穷玩家', 100, () => ({ player: 1 }));
    const b = play('VIP 大户', 1e9, (r): Record<string, number> => (r % 3 === 0 ? { tie: 500_000 } : { banker: 900_000, tie: 10 }));
    expect(a).toEqual(b);
  });

  it('BACF-02 牌靴模块只依赖实体牌与随机数；规则 / 引擎里没有任何依据玩家情况调整的代码', () => {
    const src = (f: string) => fs.readFileSync(new URL('../src/core/baccarat/' + f, import.meta.url), 'utf8');
    const imports = [...src('shoe.ts').matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['../cards/physical', '../utils/random']);
    for (const f of ['shoe.ts', 'engine.ts', 'rules.ts']) expect(src(f)).not.toMatch(/Math\.random|streak|pity|luck|vip|level|winRate/i);
    const uses = [...src('engine.ts').matchAll(/this\.shoe\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(uses)].sort()).toEqual(['beginRound', 'decks', 'draw', 'remaining', 'shoeId', 'size', 'toState']);
  });

  it('BACF-03 30,000 局逐局核对（独立的补牌表、结果、赔付、派彩次数、余额、同一牌靴不重复）；分布没有明显偏差', () => {
    const r = simulateBaccarat({ rounds: 30_000, rng: seededRandom(2026) });
    expect(r.problems).toEqual([]);
    expect(r.chiRank).toBeLessThan(BAC_CHI_LIMIT.rank);
    expect(r.chiSuit).toBeLessThan(BAC_CHI_LIMIT.suit);
    // 只用来发现明显错误（例如补牌表写错会让庄 / 闲比例偏离好几个百分点），不是目标值
    expect(Math.abs(r.outcome.banker - BAC_THEORY.banker)).toBeLessThan(0.015);
    expect(Math.abs(r.outcome.player - BAC_THEORY.player)).toBeLessThan(0.015);
    expect(Math.abs(r.outcome.tie - BAC_THEORY.tie)).toBeLessThan(0.01);
  }, 60_000);

  it('BACF-04 使用真正的加密随机数打 5,000 局：没有任何问题', () => {
    expect(simulateBaccarat({ rounds: 5000 }).problems).toEqual([]);
  }, 60_000);

  it('BACF-05 核对工具本身能发现错误的补牌与赔付', () => {
    const c = (s: string) => parseCards(s);
    expect(expectedCardCounts(c('2s 3c 8s'), c('Kd 3h'))).toEqual({ player: 3, banker: 2 });
    expect(expectedCardCounts(c('6s Kc'), c('2d 3h'))).toEqual({ player: 2, banker: 3 });
    expect(expectedCardCounts(c('4s 5c'), c('2d 3h'))).toEqual({ player: 2, banker: 2 });
    expect(expectedReturns({ player: 100, banker: 100, tie: 100 }, 'banker')).toEqual({ player: 0, banker: 195, tie: 0 });
    expect(expectedReturns({ player: 100, banker: 100, tie: 100 }, 'tie')).toEqual({ player: 100, banker: 100, tie: 900 });
  });
});
