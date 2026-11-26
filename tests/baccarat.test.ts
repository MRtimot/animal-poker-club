// 百家乐：点数、补牌表、赔付、下注校验、牌靴、引擎状态机、隐藏信息
import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/core/cards/card';
import { cardFromCode } from '../src/core/cards/physical';
import { BaccaratEngine } from '../src/core/baccarat/engine';
import {
  BAC_TIERS,
  DEFAULT_BAC_RULES,
  bacBetError,
  bacCardValue,
  bacScore,
  bankerDraws,
  cleanBacRules,
  dealCoup,
  isNatural,
  playerDraws,
  spotPayout,
  totalPayout,
  winnerOf,
} from '../src/core/baccarat/rules';
import { BacShoe } from '../src/core/baccarat/shoe';
import { BAC_TRANSITIONS } from '../src/core/baccarat/types';
import { seededRandom } from '../src/core/utils/random';

const cards = (s: string) => parseCards(s);

/** 按顺序指定接下来发出的牌（闲 1、庄 1、闲 2、庄 2、第三张…）：在牌靴里交换位置 */
function rig(e: BaccaratEngine, ids: string[]) {
  const s = e.toState();
  const order = [...s.shoe.order];
  ids.forEach((id, k) => {
    const at = s.shoe.next + k;
    const from = order.findIndex((c, i) => i >= at && cardFromCode(c).id === id);
    if (from < 0) throw new Error('找不到 ' + id);
    [order[at], order[from]] = [order[from], order[at]];
  });
  return BaccaratEngine.fromState({ ...s, shoe: { ...s.shoe, order } }, seededRandom(1));
}

function table(o: { players?: number; balance?: number; bets?: object[] } = {}) {
  const e = new BaccaratEngine({}, seededRandom(7));
  const n = o.players ?? 1;
  for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'P' + i, o.balance ?? 1000);
  e.openBetting();
  return e;
}
function play(e: BaccaratEngine) {
  e.closeBetting();
  while (e.hasMoreCards()) e.revealNext();
  e.resolve();
  return e;
}

describe('点数', () => {
  it('BAC-01 A = 1，2–9 按牌面，10 / J / Q / K = 0', () => {
    expect(cards('As 2s 3s 4s 5s 6s 7s 8s 9s Ts Js Qs Ks').map(bacCardValue)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 0]);
  });
  it('BAC-02 只保留个位数：7+8=5，9+6=5，8+7+6=1，K+Q=0，A+9=0', () => {
    expect([bacScore(cards('7s 8d')), bacScore(cards('9s 6d')), bacScore(cards('8s 7d 6c')), bacScore(cards('Ks Qd')), bacScore(cards('As 9d'))]).toEqual([5, 5, 1, 0, 0]);
  });
  it('BAC-03 例牌：最初两张 8 或 9；三张凑成 9 不算', () => {
    expect([isNatural(cards('4s 4d')), isNatural(cards('Ks 9d')), isNatural(cards('3s 4d')), isNatural(cards('3s 3d 3c'))]).toEqual([true, true, false, false]);
  });
});

describe('补牌表', () => {
  it('BAC-04 闲家：0–5 补牌，6–7 停牌', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(playerDraws)).toEqual([true, true, true, true, true, true, false, false]);
  });
  it('BAC-05 庄家完整补牌表（闲家没补 / 闲家第三张 0–9）与标准表逐格一致', () => {
    // 标准 Punto Banco 表：行 = 庄家两张的点数，列 = 闲家第三张的点数（D = 补，S = 停）
    const STANDARD: Record<number, string> = {
      0: 'DDDDDDDDDD',
      1: 'DDDDDDDDDD',
      2: 'DDDDDDDDDD',
      3: 'DDDDDDDDSD',
      4: 'SSDDDDDDSS',
      5: 'SSSSDDDDSS',
      6: 'SSSSSSDDSS',
      7: 'SSSSSSSSSS',
    };
    for (let total = 0; total <= 7; total++) {
      expect([...Array(10).keys()].map((t) => (bankerDraws(total, t) ? 'D' : 'S')).join('')).toBe(STANDARD[total]);
      expect(bankerDraws(total, null)).toBe(total <= 5);
    }
  });
  it('BAC-06 发牌顺序与补牌：闲 1、庄 1、闲 2、庄 2；任一方例牌时双方都不补', () => {
    const deal = (ids: string) => {
      const q = cards(ids);
      const r = dealCoup(() => q.shift()!);
      return [r.player.map((c) => c.id).join(' '), r.banker.map((c) => c.id).join(' ')];
    };
    // 闲 4+5=9 例牌；庄 2+3=5 本来要补，但例牌时不补
    expect(deal('4s 2d 5c 3h 9s')).toEqual(['4s 5c', '2d 3h']);
    // 闲 2+3=5 补 8；庄 3 而闲第三张是 8：庄停
    expect(deal('2s Kd 3c 3h 8s 9h')).toEqual(['2s 3c 8s', 'Kd 3h']);
    // 闲 6 停；庄 5（闲没补）补
    expect(deal('6s 2d Kc 3h 4s')).toEqual(['6s Kc', '2d 3h 4s']);
    // 闲 7 停；庄 6 停
    expect(deal('7s 6d Kc Kh 4s')).toEqual(['7s Kc', '6d Kh']);
    // 闲 1 补 6；庄 6 且闲第三张 6：补
    expect(deal('As 6d Kc Kh 6s 2h')).toEqual(['As Kc 6s', '6d Kh 2h']);
  });
  it('BAC-07 结果：点大者赢，相同为和', () => {
    expect([winnerOf(7, 5), winnerOf(4, 8), winnerOf(6, 6)]).toEqual(['player', 'banker', 'tie']);
  });
});

describe('赔付与下注', () => {
  it('BAC-08 闲 1:1；庄 1:1 抽 5%（向下取整，永远是整数）；和 8:1；开和时闲 / 庄退回', () => {
    expect([spotPayout('player', 100, 'player'), spotPayout('player', 100, 'banker'), spotPayout('player', 100, 'tie')]).toEqual([200, 0, 100]);
    expect([spotPayout('banker', 100, 'banker'), spotPayout('banker', 100, 'player'), spotPayout('banker', 100, 'tie')]).toEqual([195, 0, 100]);
    expect([spotPayout('tie', 100, 'tie'), spotPayout('tie', 100, 'player'), spotPayout('tie', 100, 'banker')]).toEqual([900, 0, 0]);
    for (let b = 1; b < 2000; b += 7) expect(Number.isInteger(spotPayout('banker', b, 'banker'))).toBe(true);
    expect(spotPayout('banker', 10, 'banker')).toBe(19);
    expect(spotPayout('banker', 15, 'banker')).toBe(29);
    expect(totalPayout({ player: 100, banker: 0, tie: 50 }, 'tie')).toBe(100 + 450);
  });
  it('BAC-09 下注校验：负数、0、小数、NaN、Infinity、字符串、未知区域、低于 / 高于限额、超过余额都被拒绝', () => {
    const r = { minBet: 10, maxBet: 500 };
    for (const bad of [null, 5, 'x', {}, { player: 0 }, { player: -10 }, { player: 10.5 }, { player: NaN }, { player: Infinity }, { player: '10' }, { dragon: 10 }, { player: 5 }, { banker: 600 }, { player: 400, tie: 400 }])
      expect(bacBetError(bad, 700, r)).not.toBeNull();
    expect(bacBetError({ player: 100, tie: 20 }, 700, r)).toBeNull();
    expect(bacBetError({ player: 1e300 }, 1e301, r)).not.toBeNull();
  });
  it('BAC-10 规则不能被配置改变：抽水 5%、和 8:1 锁定；牌靴 6–8 副；切牌位置至少 6 张', () => {
    expect(cleanBacRules({ bankerCommissionPct: 0, tiePays: 50, decks: 99, reshuffleAt: 1 } as object)).toMatchObject({ bankerCommissionPct: 5, tiePays: 8, decks: 8, reshuffleAt: 6 });
    expect(cleanBacRules(null)).toEqual(DEFAULT_BAC_RULES);
    for (const t of BAC_TIERS) expect(t.maxBet).toBeGreaterThan(t.minBet);
  });
});

describe('牌靴', () => {
  it('BAC-11 8 副牌 416 张：每张实体牌唯一，每种牌面正好 8 张', () => {
    const s = new BacShoe(8, seededRandom(3));
    const all = Array.from({ length: 416 }, () => s.draw());
    expect(new Set(all.map((c) => c.uid)).size).toBe(416);
    const byId = new Map<string, number>();
    for (const c of all) byId.set(c.id, (byId.get(c.id) ?? 0) + 1);
    expect([...byId.values()].every((n) => n === 8)).toBe(true);
    expect(byId.size).toBe(52);
    expect(() => s.draw()).toThrow('牌靴已空');
  });
  it('BAC-12 到了切牌位置才在两局之间换新牌靴；换之前不换', () => {
    const s = new BacShoe(8, seededRandom(4));
    const id = s.shoeId;
    for (let i = 0; i < 400; i++) s.draw();
    expect(s.beginRound(16)).toBe(false);
    expect(s.shoeId).toBe(id);
    s.draw();
    expect(s.beginRound(16)).toBe(true);
    expect([s.remaining, s.size]).toEqual([416, 416]);
    expect(s.shoeId).not.toBe(id);
  });
  it('BAC-13 洗牌均匀：第一张出现在 52 种牌面的概率接近 1/52', () => {
    const r = seededRandom(11);
    const n = new Array(52).fill(0);
    for (let i = 0; i < 26000; i++) n[new BacShoe(1, r).toState().order[0] % 52]++;
    for (const x of n) expect(Math.abs(x - 500)).toBeLessThan(130);
  });
});

describe('引擎', () => {
  it('BAC-14 阶段跳转表：只能按顺序前进；结果之后不能直接回到下注', () => {
    expect(BAC_TRANSITIONS.result).toEqual(['payout']);
    const e = new BaccaratEngine({}, seededRandom(1));
    e.addPlayer('a', 'A', 100);
    expect(() => e.closeBetting()).toThrow();
    e.openBetting();
    expect(() => e.openBetting()).toThrow('非法的阶段跳转');
    expect(() => e.closeBetting()).toThrow('还没有人下注');
    expect(() => e.revealNext()).toThrow();
    expect(() => e.resolve()).toThrow();
  });
  it('BAC-15 下注只能确认一次、扣在桌上；停止下注后不能再下注 / 修改', () => {
    const e = table();
    e.placeBet('p0', { player: 100, tie: 20 });
    expect(e.getPlayer('p0')!.balance).toBe(880);
    expect(() => e.placeBet('p0', { banker: 10 })).toThrow('已经下注');
    e.closeBetting();
    expect(() => e.placeBet('p0', { banker: 10 })).toThrow('停止下注');
    expect(() => e.skipBet('p0')).toThrow('停止下注');
  });
  it('BAC-16 闲赢 / 庄赢 / 和：余额与返还正确，开和时闲庄下注退回', () => {
    let e = table();
    e.placeBet('p0', { player: 100, banker: 0, tie: 10 });
    e = rig(e, ['7s', '2d', 'Kc', '3h', '4s']); // 闲 7 停；庄 5 补 4 → 9
    play(e);
    expect([e.winner, e.getPlayer('p0')!.balance]).toEqual(['banker', 890]);
    e.openBetting();
    e.placeBet('p0', { banker: 100 });
    e = rig(e, ['9s', '8d', 'Kc', 'Kh']); // 闲 9 例牌胜庄 8
    play(e);
    expect([e.winner, e.getPlayer('p0')!.balance]).toEqual(['player', 790]);
    e.openBetting();
    e.placeBet('p0', { player: 50, banker: 50, tie: 10 });
    e = rig(e, ['8s', '8d', 'Kc', 'Kh']); // 8 对 8：和
    play(e);
    expect([e.winner, e.getPlayer('p0')!.balance]).toEqual(['tie', 790 - 110 + 50 + 50 + 90]);
    e.openBetting();
    e.placeBet('p0', { banker: 100 });
    e = rig(e, ['2s', '7d', '3c', 'Kh', 'Ks']); // 闲 5 补 K → 5；庄 7 停：庄赢
    play(e);
    expect([e.winner, e.getPlayer('p0')!.balance]).toEqual(['banker', 870 - 100 + 195]);
  });
  it('BAC-17 隐藏信息：停止下注后、翻开之前，事件里没有任何一张牌；按顺序逐张公开', () => {
    const e = table();
    e.placeBet('p0', { player: 100 });
    e.closeBetting();
    expect(e.events.some((x) => x.type === 'card')).toBe(false);
    expect([e.visible('player').length, e.visible('banker').length]).toEqual([0, 0]);
    const order: string[] = [];
    while (e.hasMoreCards()) {
      e.revealNext();
      const last = [...e.events].reverse().find((x) => x.type === 'card');
      if (last?.type === 'card') order.push(`${last.side[0]}${last.index}`);
    }
    expect(order.slice(0, 4)).toEqual(['p0', 'p1', 'b0', 'b1']);
    // 补牌决定只在对应的牌公开之后出现
    const evs = e.events.map((x) => (x.type === 'card' ? `${x.side[0]}${x.index}` : x.type === 'rule' ? `rule-${x.side}` : x.type));
    const i4 = evs.indexOf('b1');
    for (const x of evs.slice(0, i4)) expect(x.startsWith('rule') || x === 'natural').toBe(false);
  });
  it('BAC-18 多名玩家共用同一副牌与同一个结果，各自的下注与派彩独立', () => {
    let e = table({ players: 3 });
    e.placeBet('p0', { player: 100 });
    e.placeBet('p1', { banker: 200 });
    e.placeBet('p2', { tie: 50 });
    e = rig(e, ['9s', '8d', 'Kc', 'Kh']);
    play(e);
    expect(e.players.map((p) => p.balance)).toEqual([1100, 800, 950]);
    expect(e.events.filter((x) => x.type === 'payout').length).toBe(3);
  });
  it('BAC-19 一局中途离开：下注照常按真实结果结算一次，不能逃掉输的注', () => {
    let e = table({ players: 2 });
    e.placeBet('p0', { player: 100 });
    e.placeBet('p1', { banker: 100 });
    e = rig(e, ['9s', '8d', 'Kc', 'Kh']);
    e.closeBetting();
    e.revealNext();
    const facts = e.factsOf('p1')!;
    expect([facts.winner, facts.profit]).toEqual(['player', -100]);
    e.removePlayer('p1');
    while (e.hasMoreCards()) e.revealNext();
    e.resolve();
    expect(e.getPlayer('p1')!.left).toBe(true);
    e.openBetting();
    expect(e.getPlayer('p1')).toBeUndefined();
  });
  it('BAC-20 下注阶段离开：下注退回；下一局全部清空，结果历史保留', () => {
    const e = table({ players: 2 });
    e.placeBet('p1', { banker: 100 });
    e.removePlayer('p1');
    expect(e.getPlayer('p1')).toBeUndefined();
    e.placeBet('p0', { player: 10 });
    play(e);
    const round = e.roundId;
    e.openBetting();
    expect([e.coup.player.length, e.revealed, e.winner, e.getPlayer('p0')!.placed, e.getPlayer('p0')!.bets.player]).toEqual([0, 0, null, false, 0]);
    expect(e.roundId).not.toBe(round);
    expect(e.history.length).toBe(1);
  });
  it('BAC-21 保存 / 恢复后继续：结果完全一致', () => {
    const e = table({ players: 2 });
    e.placeBet('p0', { player: 100 });
    e.placeBet('p1', { tie: 20 });
    e.closeBetting();
    e.revealNext();
    const copy = BaccaratEngine.fromState(JSON.parse(JSON.stringify(e.toState())));
    for (const x of [e, copy]) {
      while (x.hasMoreCards()) x.revealNext();
      x.resolve();
    }
    expect(copy.players.map((p) => p.balance)).toEqual(e.players.map((p) => p.balance));
    expect(copy.winner).toBe(e.winner);
  });
  it('BAC-22 随机打 5000 局（1~6 人）：筹码守恒、没有重复的实体牌、余额不为负、补牌与独立的规则推算一致', () => {
    const r = seededRandom(2027);
    let rounds = 0;
    for (let t = 0; t < 50; t++) {
      const n = 1 + Math.floor(r() * 6);
      const e = new BaccaratEngine({ minBet: 10, maxBet: 500 }, r);
      for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'P' + i, 10 + Math.floor(r() * 3000));
      const seen = new Set<string>();
      for (let k = 0; k < 100; k++) {
        e.openBetting();
        if (e.events.some((x) => x.type === 'shuffle')) seen.clear();
        const before = new Map(e.players.map((p) => [p.id, p.balance]));
        for (const p of e.players) {
          if (r() < 0.2 || !e.canBet(p)) continue;
          const spot = (['player', 'banker', 'tie'] as const)[Math.floor(r() * 3)];
          e.placeBet(p.id, { [spot]: Math.min(p.balance, 10 + Math.floor(r() * 50)) });
        }
        if (!e.hasBets()) {
          const p = e.players[0];
          if (!e.canBet(p)) e.setBalance(p.id, 1000);
          before.set(p.id, p.balance);
          e.placeBet(p.id, { player: 10 });
        }
        play(e);
        const all = [...e.coup.player, ...e.coup.banker];
        for (const c of all) {
          expect(seen.has(c.uid)).toBe(false);
          seen.add(c.uid);
        }
        // 独立推算：同样的牌按规则重新发一次
        const q = [e.coup.player[0], e.coup.banker[0], e.coup.player[1], e.coup.banker[1], e.coup.player[2], e.coup.banker[2]].filter(Boolean);
        const pThird = e.coup.player[2];
        const order = [e.coup.player[0], e.coup.banker[0], e.coup.player[1], e.coup.banker[1], ...(pThird ? [pThird] : []), ...(e.coup.banker[2] ? [e.coup.banker[2]] : [])];
        const again = dealCoup(() => order.shift()!);
        expect([again.player.length, again.banker.length]).toEqual([e.coup.player.length, e.coup.banker.length]);
        expect(q.length).toBe(all.length);
        for (const p of e.players) {
          const want = before.get(p.id)! - (p.placed ? p.bets.player + p.bets.banker + p.bets.tie : 0) + (p.placed ? totalPayout(p.bets, e.winner!) : 0);
          expect(p.balance).toBe(want);
          expect(p.balance).toBeGreaterThanOrEqual(0);
        }
        rounds++;
      }
    }
    expect(rounds).toBe(5000);
  });
});
