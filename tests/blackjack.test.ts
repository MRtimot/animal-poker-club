// 21 点核心：点数、黑杰克、牌靴、状态机、下注与赔付、加倍 / 分牌、庄家规则、控制器节奏、暗牌保密、防重复
import { describe, expect, it, vi } from 'vitest';
import { parseCards } from '../src/core/cards/card';
import { evaluateBlackjack, valueText } from '../src/core/blackjack/hand';
import { BlackjackEngine, BlackjackError } from '../src/core/blackjack/engine';
import { DEFAULT_RULES, betError, cleanRules, payoutFor, type HandResult } from '../src/core/blackjack/rules';
import { Shoe, cardFromCode } from '../src/core/blackjack/shoe';
import { BlackjackController, type BlackjackHooks, type BlackjackOptions, type BjSeatConfig } from '../src/core/blackjack/controller';
import { rigNext, rigShoe, forceOutcome, type ForcedOutcome } from '../src/core/blackjack/debug';
import { basicStrategy } from '../src/core/blackjack/strategy';
import { DEALERS, isDealerChoice, pickDealer } from '../src/core/blackjack/dealers';
import { BJ_DIALOGUE } from '../src/core/blackjack/dialogue';
import { BJ_TRANSITIONS, type BjRoundFacts } from '../src/core/blackjack/types';
import { DIALOGUE, pickLine } from '../src/core/character/dialogue';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import { seededRandom } from '../src/core/utils/random';

const ev = (s: string, split = false) => evaluateBlackjack(parseCards(s), split);
const prof = (name: string) => ({ name, animal: DEFAULT_ANIMAL, level: 1 });

/** 开一局：players 名玩家各下注 bet，接下来的牌固定为 cards（庄家明牌 → 玩家们 → 庄家暗牌 → 玩家们 → 后续） */
function table(cards: string, o: { players?: number; bet?: number; balance?: number; rules?: object; seed?: number } = {}) {
  let e = new BlackjackEngine(o.rules, seededRandom(o.seed ?? 5));
  const n = o.players ?? 1;
  for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'P' + i, o.balance ?? 1000);
  e.openBetting();
  for (let i = 0; i < n; i++) e.placeBet('p' + i, o.bet ?? 100);
  const s = e.toState();
  e = BlackjackEngine.fromState({ ...s, shoe: rigNext(s.shoe, cards.split(/\s+/)) }, seededRandom(9));
  e.deal();
  e.beginTurns();
  return e;
}
const finish = (e: BlackjackEngine) => {
  for (let i = 0; i < 30 && e.phase === 'dealer-turn'; i++) e.dealerStep();
  return e;
};
const results = (e: BlackjackEngine, id = 'p0') => e.getPlayer(id)!.hands.map((h) => h.result);
const bal = (e: BlackjackEngine, id = 'p0') => e.getPlayer(id)!.balance;

describe('点数计算', () => {
  it('BJ-01 A + K = 黑杰克 21', () => expect(ev('As Kd')).toEqual({ value: 21, soft: true, blackjack: true, bust: false }));
  it('BJ-02 A + 9 = 20', () => expect(ev('As 9d').value).toBe(20));
  it('BJ-03 A + 6 = 软 17', () => expect(ev('As 6d')).toMatchObject({ value: 17, soft: true, bust: false }));
  it('BJ-04 A + 6 + 10 = 硬 17', () => expect(ev('As 6d Th')).toMatchObject({ value: 17, soft: false, bust: false }));
  it('BJ-05 10 + 8 = 18', () => expect(ev('Th 8d')).toMatchObject({ value: 18, soft: false }));
  it('BJ-06 10 + 8 + 5 = 23 爆牌', () => expect(ev('Th 8d 5c')).toMatchObject({ value: 23, bust: true }));
  it('BJ-07 A + A = 12', () => expect(ev('As Ad')).toMatchObject({ value: 12, soft: true, blackjack: false }));
  it('BJ-08 A + A + 9 = 21（不是黑杰克）', () => expect(ev('As Ad 9c')).toMatchObject({ value: 21, blackjack: false }));
  it('BJ-09 A + A + 9 + 5 = 16', () => expect(ev('As Ad 9c 5h')).toMatchObject({ value: 16, soft: false }));
  it('BJ-10 A + 5 + 10 = 16；A + 9 + 5 = 15；A + 5 = 16', () => expect([ev('As 5d Th').value, ev('As 9d 5h').value, ev('As 5d').value]).toEqual([16, 15, 16]));
  it('BJ-11 A + 10/J/Q/K 都是黑杰克；A + 5 + 5 只是普通 21；分牌后的 A + 10 不算黑杰克', () => {
    for (const t of ['T', 'J', 'Q', 'K']) expect(ev(`As ${t}d`).blackjack).toBe(true);
    expect(ev('As 5d 5h')).toMatchObject({ value: 21, blackjack: false });
    expect(ev('As Kd', true)).toMatchObject({ value: 21, blackjack: false });
  });
  it('BJ-12 软点数的显示', () => expect([valueText(ev('As 6d')), valueText(ev('As Kd')), valueText(ev('Th 8d'))]).toEqual(['7 / 17', '21', '18']));
  it('BJ-13 任意手牌：与暴力枚举（每张 A 取 1 或 11）的最佳值一致', () => {
    const r = seededRandom(77);
    for (let k = 0; k < 4000; k++) {
      const cards = Array.from({ length: 1 + Math.floor(r() * 7) }, () => cardFromCode(Math.floor(r() * 52)));
      let sums = [0];
      for (const c of cards) sums = sums.flatMap((s) => (c.rank === 14 ? [s + 1, s + 11] : [s + Math.min(10, c.rank)]));
      const ok = sums.filter((s) => s <= 21);
      const best = ok.length ? Math.max(...ok) : Math.min(...sums);
      expect(evaluateBlackjack(cards).value).toBe(best);
    }
  });
});

describe('牌组', () => {
  it('BJ-14 一副标准 52 张：13 种点数 × 4 种花色，每张实体牌唯一，发完不重复', () => {
    const shoe = new Shoe(seededRandom(3));
    const cards = Array.from({ length: 52 }, () => shoe.draw());
    expect(new Set(cards.map((c) => c.uid)).size).toBe(52);
    expect(new Set(cards.map((c) => c.id)).size).toBe(52);
    for (let r = 2; r <= 14; r++) expect(cards.filter((c) => c.rank === r).length).toBe(4);
    for (const suit of new Set(cards.map((c) => c.suit))) expect(cards.filter((c) => c.suit === suit).length).toBe(13);
  });
  it('BJ-15 一局把 52 张发完（极少见）：再拆一副新的实体牌，不会重复发出已经发过的牌', () => {
    const shoe = new Shoe(seededRandom(4));
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const c = shoe.draw();
      expect(seen.has(c.uid)).toBe(false);
      seen.add(c.uid);
    }
    expect(shoe.toState().opened).toBe(2);
  });
  it('BJ-16 每一局都换一副新的 52 张并重新洗牌（上一局的牌不会带进下一局）', () => {
    const shoe = new Shoe(seededRandom(4));
    const first = JSON.stringify(shoe.toState().order);
    for (let i = 0; i < 9; i++) shoe.draw();
    shoe.newRound();
    expect([shoe.remaining, shoe.size, shoe.toState().opened]).toEqual([52, 52, 1]);
    expect([...shoe.toState().order].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
    expect(JSON.stringify(shoe.toState().order)).not.toBe(first);
  });
  it('BJ-17 洗牌均匀：每张牌出现在第一张的概率接近 1/52', () => {
    const r = seededRandom(11);
    const n = new Array(52).fill(0);
    for (let i = 0; i < 26000; i++) n[new Shoe(r).toState().order[0]]++;
    for (const x of n) expect(Math.abs(x - 500)).toBeLessThan(130);
  });
  it('BJ-18 默认使用加密安全随机数；环境没有时明确报错，不会退回 Math.random', () => {
    const real = globalThis.crypto;
    const spy = Math.random;
    let used = 0;
    Math.random = () => (used++, 0.5);
    try {
      expect(new Shoe().toState().order.length).toBe(52);
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      expect(() => new Shoe()).toThrow('安全随机数');
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
      Math.random = spy;
    }
    expect(used).toBe(0);
  });
});

describe('下注与赔付', () => {
  const r = { minBet: 10, maxBet: 500 };
  it('BJ-19 下注校验：0、负数、小数、NaN、字符串、低于最低、高于最高、超过余额都被拒绝', () => {
    for (const bad of [0, -5, 10.5, NaN, Infinity, '50', null, undefined, {}]) expect(betError(bad, 1000, r), String(bad)).toBeTruthy();
    expect(betError(9, 1000, r)).toContain('最低');
    expect(betError(501, 1000, r)).toContain('最高');
    expect(betError(200, 150, r)).toBe('金币不足');
    expect(betError(150, 150, r)).toBeNull();
  });
  it('BJ-20 赔付：赢 1:1、黑杰克 3:2、平局退回、输 0；奇数黑杰克向下取整', () => {
    const pay = (b: number, x: HandResult) => payoutFor(b, x, DEFAULT_RULES);
    expect([pay(100, 'win'), pay(100, 'blackjack'), pay(100, 'push'), pay(100, 'lose'), pay(100, 'bust'), pay(100, 'dealer-blackjack'), pay(100, 'forfeit')]).toEqual([200, 250, 100, 0, 0, 0, 0]);
    expect(pay(5, 'blackjack')).toBe(12);
  });
  it('BJ-21 引擎拒绝非法下注，余额不会变负；不能重复下注', () => {
    const e = new BlackjackEngine({ minBet: 10, maxBet: 500 }, seededRandom(1));
    e.addPlayer('a', 'A', 60);
    expect(() => e.placeBet('a', 20)).toThrow(BlackjackError);
    e.openBetting();
    expect(() => e.placeBet('a', 100)).toThrow('金币不足');
    expect(() => e.placeBet('ghost', 10)).toThrow(BlackjackError);
    e.placeBet('a', 60);
    expect(bal(e, 'a')).toBe(0);
    expect(() => e.placeBet('a', 10)).toThrow('已经下注');
  });
  it('BJ-22 规则参数缺失 / 非法时回到安全值', () => {
    expect(cleanRules({ decks: 99, minBet: -1, maxBet: 0, maxHands: 50, penetration: 5 } as object)).toMatchObject({ decks: 1, minBet: 1, maxBet: 1, maxHands: 2 });
    expect(cleanRules(null)).toEqual(DEFAULT_RULES);
  });
});

describe('一局的流程', () => {
  it('BJ-23 发牌：每人两张、庄家一明一暗；暗牌事件不带牌', () => {
    const e = table('9d Ts 7c 5h', { players: 1 });
    expect(e.dealer.map((c) => c.id)).toEqual(['9d', '7c']);
    expect(e.getPlayer('p0')!.hands[0].cards.map((c) => c.id)).toEqual(['Ts', '5h']);
    const deals = e.events.filter((x) => x.type === 'card') as Extract<(typeof e.events)[number], { type: 'card' }>[];
    expect(deals.map((x) => [x.to, x.card?.id ?? null])).toEqual([['dealer', '9d'], ['p0', 'Ts'], ['dealer', null], ['p0', '5h']]);
  });
  it('BJ-24 要牌：未爆继续行动；爆牌立即结束，庄家只翻牌不补牌', () => {
    const e = table('9d Ts 7c 5h 2c Kh', {});
    e.act('p0', 'hit');
    expect([e.phase, e.getPlayer('p0')!.hands[0].cards.length]).toEqual(['player-turn', 3]);
    e.act('p0', 'hit');
    expect(e.phase).toBe('dealer-turn');
    finish(e);
    expect(results(e)).toEqual(['bust']);
    expect(e.dealer.length).toBe(2);
    expect(bal(e)).toBe(900);
  });
  it('BJ-25 要到 21 点自动停牌', () => {
    const e = table('9d Ts 7c 5h 6c', {});
    e.act('p0', 'hit');
    expect(e.phase).toBe('dealer-turn');
    expect(e.events.some((x) => x.type === 'stand' && x.auto)).toBe(true);
  });
  it('BJ-26 停牌 → 庄家不足 17 必须补牌，17 及以上停牌；玩家赢', () => {
    const e = table('9d Ts 2c Qh 5s 3h', {});
    e.act('p0', 'stand');
    finish(e); // 庄家 9 + 2 + 5 + 3 = 19
    expect(e.dealer.map((c) => c.id)).toEqual(['9d', '2c', '5s', '3h']);
    expect(results(e)).toEqual(['win']);
    expect(bal(e)).toBe(1100);
  });
  it('BJ-27 庄家爆牌：没爆的玩家赢', () => {
    const e = table('Td 8s 6c 5h Kh', {});
    e.act('p0', 'stand');
    finish(e);
    expect(results(e)).toEqual(['win']);
    expect(e.events.some((x) => x.type === 'dealerBust')).toBe(true);
  });
  it('BJ-28 平局退回下注；输掉下注', () => {
    const push = table('Td Ks 9c 9h', {});
    push.act('p0', 'stand');
    expect([results(finish(push)), bal(push)]).toEqual([['push'], 1000]);
    const lose = table('Td Ks 9c 8h', {});
    lose.act('p0', 'stand');
    expect([results(finish(lose)), bal(lose)]).toEqual([['lose'], 900]);
  });
  it('BJ-29 玩家黑杰克 3:2；对庄家黑杰克是平局；普通 21 输给庄家黑杰克', () => {
    const bj = finish(table('9d As 8c Kh', {}));
    expect([results(bj), bal(bj)]).toEqual([['blackjack'], 1150]);
    const both = finish(table('Ad As Kc Kh', {}));
    expect([results(both), bal(both)]).toEqual([['push'], 1000]);
    const dealer = finish(table('Ad Ts Kc 9h', {}));
    expect([results(dealer), bal(dealer)]).toEqual([['dealer-blackjack'], 900]);
  });
  it('BJ-30 庄家明牌 A / 10 且暗牌凑成黑杰克：直接翻开，玩家没有机会加倍 / 分牌多输', () => {
    for (const up of ['Ad Ts Kc 9h', 'Kd Ts Ac 9h']) expect(table(up, {}).phase).toBe('dealer-turn');
    expect(table('9d Ts Kc 9h', {}).phase).toBe('player-turn');
  });
  it('BJ-31 软 17 一律停牌；任何配置都不能改变', () => {
    for (const rules of [{}, { dealerHitsSoft17: true }]) {
      const s = table('Ad Ts 6c 9h 2c', { rules });
      s.act('p0', 'stand');
      finish(s);
      expect(s.dealer.length).toBe(2);
    }
  });
  it('BJ-32 三张以上的 21 不是黑杰克：只赔 1:1', () => {
    const e = table('9d 7s 8c 7h 7c', {});
    e.act('p0', 'hit');
    expect([results(finish(e)), bal(e)]).toEqual([['win'], 1100]);
  });
});

describe('加倍与分牌', () => {
  it('BJ-33 加倍：只多拿一张、自动停牌、下注翻倍', () => {
    const e = table('6d 6s Tc 5h Th 5c', {});
    expect(e.getLegal('p0')!.double).toBe(true);
    e.act('p0', 'double');
    expect(e.phase).toBe('dealer-turn');
    expect(e.getPlayer('p0')!.hands[0]).toMatchObject({ bet: 200, doubled: true });
    finish(e); // 玩家 21，庄家 6+10+5=21
    expect([results(e), bal(e)]).toEqual([['push'], 1000]);
  });
  it('BJ-34 加倍：余额不足、已经要过牌时不允许', () => {
    const poor = table('6d 6s Tc 5h', { balance: 150 });
    expect(poor.getLegal('p0')!.double).toBe(false);
    expect(() => poor.act('p0', 'double')).toThrow('金币不足');
    const later = table('6d 2s Tc 3h 2c', {});
    later.act('p0', 'hit');
    expect(later.getLegal('p0')!.double).toBe(false);
    expect(() => later.act('p0', 'double')).toThrow('不能加倍');
    expect(bal(later)).toBe(900);
  });
  it('BJ-35 分牌：两手各补一张、各自下注、依次行动、分别结算', () => {
    const e = table('6d 8s Tc 8h 3c Th 9s 2c Kd', {});
    e.act('p0', 'split');
    const p = e.getPlayer('p0')!;
    expect(p.hands.map((h) => h.cards.map((c) => c.id))).toEqual([['8s', '3c'], ['8h', 'Th']]);
    expect([p.hands[0].bet, p.hands[1].bet, p.balance]).toEqual([100, 100, 800]);
    expect(e.current!.handId).toBe(p.hands[0].id);
    e.act('p0', 'hit'); // 8+3+9 = 20
    e.act('p0', 'stand');
    expect(e.current!.handId).toBe(p.hands[1].id);
    e.act('p0', 'stand'); // 18
    finish(e); // 庄家 6+10+2 = 18
    expect([results(e), bal(e)]).toEqual([['win', 'push'], 1100]);
  });
  it('BJ-36 分 A：每手只补一张并自动停牌；A + 10 不算黑杰克（只赔 1:1）', () => {
    const e = table('6d As Tc Ah Kh 5c 9s', {});
    e.act('p0', 'split');
    expect(e.phase).toBe('dealer-turn');
    finish(e); // 庄家 6+10+9 爆
    expect([results(e), bal(e)]).toEqual([['win', 'win'], 1200]);
  });
  it('BJ-37 分牌条件：最初两张牌面相同；余额不足不可分（状态不变）；分过的不能再分', () => {
    expect(table('6d Ks 9c Kh', {}).getLegal('p0')!.split).toBe(true);
    expect(table('6d Ts 9c Kh', {}).getLegal('p0')!.split).toBe(false);
    const poor = table('6d 8s 9c 8h', { balance: 150 });
    expect(poor.getLegal('p0')!.split).toBe(false);
    expect(() => poor.act('p0', 'split')).toThrow('金币不足');
    expect([bal(poor), poor.getPlayer('p0')!.hands.length, poor.getPlayer('p0')!.hands[0].bet]).toEqual([50, 1, 100]);
    const e = table('6d 8s 9c 8h 8d 8c', { rules: { maxHands: 4 } });
    e.act('p0', 'split');
    expect(() => e.act('p0', 'split')).toThrow('不能分牌');
    expect([e.getPlayer('p0')!.hands.length, bal(e)]).toEqual([2, 800]);
  });
  it('BJ-38 分牌后的手牌不能加倍（加倍只限最初两张牌）', () => {
    const e = table('6d 8s Tc 8h 3c 2h', { rules: { doubleAfterSplit: true } });
    e.act('p0', 'split');
    expect(e.getLegal('p0')!.double).toBe(false);
    expect(() => e.act('p0', 'double')).toThrow('不能加倍');
    expect(bal(e)).toBe(800);
  });
});

describe('状态机与非法操作', () => {
  it('BJ-39 阶段跳转表：只能按顺序前进', () => {
    expect(BJ_TRANSITIONS['player-turn']).toEqual(['dealer-turn']);
    const e = new BlackjackEngine({}, seededRandom(1));
    e.addPlayer('a', 'A', 100);
    expect(() => e.deal()).toThrow();
    e.openBetting();
    expect(() => e.openBetting()).toThrow('非法的阶段跳转');
    expect(() => e.deal()).toThrow('还没有人下注');
    expect(() => e.beginTurns()).toThrow();
    expect(() => e.dealerStep()).toThrow();
    expect(() => e.act('a', 'hit')).toThrow('现在不能执行');
  });
  it('BJ-40 停牌后 / 爆牌后 / 结束后不能再要牌；发牌后不能下注；一局中不能重开', () => {
    const e = table('9d Ts 7c 8h', {});
    expect(() => e.placeBet('p0', 10)).toThrow('不能下注');
    e.act('p0', 'stand');
    expect(() => e.act('p0', 'hit')).toThrow();
    expect(() => e.openBetting()).toThrow();
    finish(e);
    expect(() => e.act('p0', 'stand')).toThrow();
    expect(() => e.dealerStep()).toThrow();
    expect(e.phase).toBe('round-end');
  });
  it('BJ-41 不是自己的回合不能行动；行动令牌过期（重复点击 / 重发）被拒绝，不会多发牌', () => {
    const e = table('9d 2s 3s 7c 2h 3h 4c 5c', { players: 2 });
    expect(() => e.act('p1', 'hit')).toThrow('还没轮到你');
    const t = e.token;
    e.act('p0', 'hit', t);
    for (let i = 0; i < 9; i++) expect(() => e.act('p0', 'hit', t)).toThrow('已经处理过了');
    expect(e.getPlayer('p0')!.hands[0].cards.length).toBe(3);
  });
  it('BJ-42 多名玩家依次行动，各自与庄家比较', () => {
    const e = table('9d Ts As 6s 8c 9h Kh 5h Kc', { players: 3 });
    // p0: 10+9=19, p1: A+K 黑杰克, p2: 6+5=11
    expect(e.current!.playerId).toBe('p0');
    e.act('p0', 'stand');
    expect(e.current!.playerId).toBe('p2');
    e.act('p2', 'double'); // 21
    finish(e); // 庄家 17
    expect([results(e, 'p0'), results(e, 'p1'), results(e, 'p2')]).toEqual([['win'], ['blackjack'], ['win']]);
    expect([bal(e, 'p0'), bal(e, 'p1'), bal(e, 'p2')]).toEqual([1100, 1150, 1200]);
  });
  it('BJ-43 离开：下注阶段退回；一局中放弃手牌并轮到下一位；不影响其他人', () => {
    const b = new BlackjackEngine({}, seededRandom(1));
    b.addPlayer('a', 'A', 100);
    b.openBetting();
    b.placeBet('a', 50);
    b.removePlayer('a');
    expect(b.players.length).toBe(0);
    const e = table('9d Ts 8s 8c 9h Kh', { players: 2 });
    e.removePlayer('p0');
    expect(e.current!.playerId).toBe('p1');
    e.act('p1', 'stand');
    finish(e);
    expect(results(e, 'p0')).toEqual(['forfeit']);
    expect(results(e, 'p1')).toEqual(['win']);
    e.openBetting();
    expect(e.players.map((p) => p.id)).toEqual(['p1']);
  });
  it('BJ-44 下一局：手牌、下注、庄家、事件全部清空，余额保留，局号不同', () => {
    const e = table('9d Ts 7c 8h', {});
    e.act('p0', 'stand');
    finish(e);
    const id = e.roundId;
    const money = bal(e);
    e.openBetting();
    expect([e.dealer.length, e.holeRevealed, e.current, e.getPlayer('p0')!.hands.length, e.getPlayer('p0')!.bet, bal(e)]).toEqual([0, false, null, 0, 0, money]);
    expect(e.roundId).not.toBe(id);
    expect(e.roundId).toMatch(/^blackjack-round-[a-z0-9]{12}$/);
    expect(e.events.every((x) => x.type === 'roundStart' || x.type === 'shuffle')).toBe(true);
  });
  it('BJ-45 保存 / 恢复后继续：结果完全一致', () => {
    const a = table('9d Ts 2c 5h 2h 4c Kd', {});
    const b = BlackjackEngine.fromState(JSON.parse(JSON.stringify(a.toState())), seededRandom(1));
    for (const e of [a, b]) {
      e.act('p0', 'hit');
      e.act('p0', 'stand');
      finish(e);
    }
    expect(b.dealer).toEqual(a.dealer);
    expect(b.getPlayer('p0')).toEqual(a.getPlayer('p0'));
  });
  it('BJ-46 随机打 3000 局（1~6 人、随机离开）：筹码守恒、没有重复的实体牌、不会卡住、余额不为负', () => {
    const r = seededRandom(2024);
    let rounds = 0;
    for (let t = 0; t < 300; t++) {
      const n = 1 + Math.floor(r() * 6);
      const e = new BlackjackEngine({ minBet: 10, maxBet: 500 }, r);
      for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'P' + i, 10 + Math.floor(r() * 2000));
      for (let k = 0; k < 10 && e.players.some((p) => e.canBet(p)); k++) {
        e.openBetting();
        const before = new Map(e.players.map((p) => [p.id, p.balance]));
        for (const p of e.players) {
          if (!e.canBet(p) || r() < 0.15) e.skipBet(p.id);
          else e.placeBet(p.id, Math.min(p.balance, 500, 10 + Math.floor(r() * 200)));
        }
        if (!e.hasBets()) { e.placeBet(e.players.find((p) => e.canBet(p))!.id, 10); }
        e.deal();
        e.beginTurns();
        for (let g = 0; e.phase === 'player-turn'; g++) {
          if (g > 200) throw new Error('卡住');
          const id = e.current!.playerId;
          if (r() < 0.01) { e.removePlayer(id); continue; }
          const l = e.getLegal(id)!;
          const x = r();
          e.act(id, l.split && x < 0.5 ? 'split' : l.double && x < 0.25 ? 'double' : x < 0.55 ? 'hit' : 'stand', e.token);
        }
        const uids = [...e.dealer, ...e.players.flatMap((p) => p.hands.flatMap((h) => h.cards))].map((c) => c.uid);
        finish(e);
        const all = [...e.dealer, ...e.players.flatMap((p) => p.hands.flatMap((h) => h.cards))].map((c) => c.uid);
        expect(new Set(all).size).toBe(all.length);
        expect(uids.length).toBeLessThanOrEqual(all.length);
        expect(e.phase).toBe('round-end');
        for (const p of e.players) {
          const bet = p.hands.reduce((s, h) => s + h.bet, 0);
          const pay = p.left ? 0 : p.hands.reduce((s, h) => s + h.payout, 0);
          expect(p.balance).toBe(before.get(p.id)! - bet + pay);
          expect(p.balance).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(p.balance)).toBe(true);
        }
        // 庄家规则：有活牌时一定停在 17 以上或爆牌
        const d = evaluateBlackjack(e.dealer);
        if (e.events.some((x) => x.type === 'dealerStand')) expect(d.value).toBeGreaterThanOrEqual(17);
        rounds++;
      }
    }
    expect(rounds).toBeGreaterThan(1500);
  });
  it('BJ-47 长期结果：基本策略的玩家回报率在合理范围（没有暗改概率）', () => {
    const r = seededRandom(99);
    const e = new BlackjackEngine({ minBet: 10, maxBet: 10 }, r);
    e.addPlayer('a', 'A', 10_000_000);
    let bet = 0;
    let natural = 0;
    const N = 12000;
    for (let i = 0; i < N; i++) {
      e.openBetting();
      e.placeBet('a', 10);
      e.deal();
      if (e.events.some((x) => x.type === 'blackjack')) natural++;
      e.beginTurns();
      while (e.phase === 'player-turn') e.act('a', basicStrategy(e.getPlayer('a')!.hands.find((h) => h.id === e.current!.handId)!.cards, e.dealer[0].rank === 14 ? 11 : Math.min(10, e.dealer[0].rank), e.getLegal('a')!));
      finish(e);
      bet += e.getPlayer('a')!.hands.reduce((s, h) => s + h.bet, 0);
    }
    const edge = (bal(e, 'a') - 10_000_000) / bet;
    expect(Math.abs(edge)).toBeLessThan(0.04);
    expect(natural / N).toBeGreaterThan(0.038);
    expect(natural / N).toBeLessThan(0.058);
  });
});

// ───────────── 控制器 ─────────────

const DEALER = { profile: prof('庄家'), trait: '' };
function ctrl(seats: Partial<BjSeatConfig>[], o: Partial<BlackjackOptions> = {}, hooks: BlackjackHooks = {}) {
  const c = new BlackjackController(
    seats.map((s, i) => ({ id: s.id ?? 'p' + i, profile: s.profile ?? prof('玩家' + i), chips: s.chips ?? 1000, isAI: s.isAI ?? false, aiPersonality: s.aiPersonality })),
    { dealer: DEALER, autoRun: false, pace: 1, rng: seededRandom(21), aiRng: seededRandom(22), ...o },
  );
  c.hooks = hooks;
  c.start();
  return c;
}
/** 一直推进到没有待办或条件成立 */
function run(c: BlackjackController, until: () => boolean = () => false, max = 60) {
  for (let i = 0; i < max && !until() && c.nextWakeAt() !== null; i++) c.tick(c.nextWakeAt()!);
}
const force = (c: BlackjackController, kind: ForcedOutcome, me = 0, players = 1) => {
  const s = c.engine.toState();
  c.engine = BlackjackEngine.fromState({ ...s, shoe: forceOutcome(s.shoe, kind, me, players) }, seededRandom(1));
};

describe('控制器', () => {
  it('BJ-48 单人桌：下注没有倒计时；下注 → 发牌 → 行动 → 庄家 → 结算；结束后等玩家点下一局', () => {
    const rounds: { playerId: string; facts: BjRoundFacts }[][] = [];
    const c = ctrl([{ id: 'me' }], { solo: true }, { onRound: (r) => rounds.push(r) });
    run(c, () => c.engine.phase === 'betting');
    expect(c.nextWakeAt()).toBeNull();
    force(c, 'win');
    expect(c.handle('me', { type: 'bet', amount: 50 })).toBeNull();
    run(c, () => c.engine.phase === 'player-turn');
    expect(c.getView('me').turnDeadline).toBeNull();
    expect(c.handle('me', { type: 'stand' }, { token: c.engine.token })).toBeNull();
    run(c, () => c.engine.phase === 'round-end');
    expect(c.nextWakeAt()).toBeNull();
    expect(rounds).toHaveLength(1);
    expect(rounds[0][0].facts).toMatchObject({ bet: 50, payout: 100, profit: 50 });
    expect(c.handle('me', { type: 'next' })).toBeNull();
    expect(c.handle('me', { type: 'next' })).toBeNull(); // 连点不会开两局
    run(c, () => c.engine.phase === 'betting');
    expect(c.engine.round).toBe(2);
  });

  it('BJ-49 暗牌保密：翻开之前，视图、事件、合法动作里都找不到它（所有观众都一样）', () => {
    for (let seed = 1; seed < 60; seed++) {
      const c = ctrl([{ id: 'a' }, { id: 'b' }], { rng: seededRandom(seed) });
      run(c, () => c.engine.phase === 'betting');
      c.handle('a', { type: 'bet', amount: 20 });
      c.handle('b', { type: 'bet', amount: 20 });
      run(c, () => c.engine.phase === 'player-turn' || c.engine.phase === 'dealer-turn');
      const hole = c.engine.dealer[1].uid;
      for (const who of ['a', 'b', 'nobody']) {
        const json = JSON.stringify(c.getView(who));
        expect(json.includes(`"${hole}"`)).toBe(false);
        const v = c.getView(who);
        expect(v.dealer.cards[1]).toBeNull();
        expect(v.dealer.blackjack).toBe(false);
        expect(v.dealer.value).toBe(evaluateBlackjack([c.engine.dealer[0]]).value);
        expect(json.includes('"order"')).toBe(false);
      }
    }
  });

  it('BJ-50 多人桌：第一个人下注后开始倒计时；没下注的到时跳过；全部下注立刻发牌', () => {
    const c = ctrl([{ id: 'a' }, { id: 'b' }]);
    run(c, () => c.engine.phase === 'betting');
    expect(c.nextWakeAt()).toBeNull(); // 没人下注：不空转
    c.handle('a', { type: 'bet', amount: 20 });
    expect(c.getView('b').turnDeadline).not.toBeNull();
    c.tick(c.nextWakeAt()!);
    expect(c.engine.phase).toBe('dealing');
    expect([c.engine.getPlayer('a')!.hands.length, c.engine.getPlayer('b')!.hands.length]).toEqual([1, 0]);
    const d = ctrl([{ id: 'a' }, { id: 'b' }]);
    run(d, () => d.engine.phase === 'betting');
    d.handle('a', { type: 'bet', amount: 20 });
    d.handle('b', { type: 'bet', amount: 20 });
    expect(d.nextWakeAt()! - Date.now()).toBeLessThan(2000);
  });

  it('BJ-51 行动超时自动停牌；断线玩家缩短时间且反复断线不能延长；离线玩家不阻塞下注', () => {
    const c = ctrl([{ id: 'a' }, { id: 'b' }], { turnTimeMs: 20000, offlineTurnMs: 6000 });
    run(c, () => c.engine.phase === 'betting');
    force(c, 'loss', 0, 2);
    c.handle('a', { type: 'bet', amount: 20 });
    c.handle('b', { type: 'bet', amount: 20 });
    run(c, () => c.engine.phase === 'player-turn');
    expect(c.engine.current!.playerId).toBe('a');
    c.setConnected('a', false);
    const first = c.getView('a').turnDeadline!;
    vi.useFakeTimers({ now: Date.now() + 3000 });
    try {
      c.setConnected('a', true);
      c.setConnected('a', false);
      expect(c.getView('a').turnDeadline!).toBeLessThanOrEqual(first);
    } finally {
      vi.useRealTimers();
    }
    c.tick(c.nextWakeAt()!);
    expect(c.engine.getPlayer('a')!.hands[0].done).toBe(true);
    expect(c.engine.current?.playerId).not.toBe('a');
    const d = ctrl([{ id: 'a' }, { id: 'b' }]);
    run(d, () => d.engine.phase === 'betting');
    d.setConnected('b', false);
    d.handle('a', { type: 'bet', amount: 20 });
    expect(d.nextWakeAt()! - Date.now()).toBeLessThan(2000);
  });

  it('BJ-52 连点 10 次要牌：只执行一次；过期的局号、AI 座位、陌生人、未知操作都被拒绝', () => {
    const c = ctrl([{ id: 'me' }, { id: 'bot', isAI: true, aiPersonality: 'smartCat' }], { solo: true });
    run(c, () => c.engine.phase === 'betting');
    const s = c.engine.toState();
    c.engine = BlackjackEngine.fromState({ ...s, shoe: rigShoe(s.shoe, new Map([[1, '2s'], [4, '3s'], [6, '2h'], [7, '2d']])) }, seededRandom(3));
    c.handle('me', { type: 'bet', amount: 20 });
    run(c, () => c.engine.phase === 'player-turn');
    const ref = { round: c.engine.round, token: c.engine.token };
    const out = Array.from({ length: 10 }, () => c.handle('me', { type: 'hit' }, ref));
    expect(out.filter((x) => x === null)).toHaveLength(1);
    expect(c.engine.getPlayer('me')!.hands[0].cards.length).toBe(3);
    expect(c.handle('me', { type: 'hit' }, { round: 99 })).toBe('这一局已经结束');
    expect(c.handle('bot', { type: 'hit' })).toBeTruthy();
    expect(c.handle('ghost', { type: 'hit' })).toBeTruthy();
    expect(c.handle('me', { type: 'cheat' } as never)).toBe('无效操作');
    expect(c.handle('me', { type: 'bet', amount: 50 })).toBe('现在不能下注');
    expect(c.handle('me', { type: 'rebuy' })).toBe('现在不能执行这个操作');
  });

  it('BJ-53 同桌 AI：自动下注并按策略行动，一局能自己走完；输光后自动补给；AI 不会单独开局', () => {
    const c = ctrl([{ id: 'me', chips: 100000 }, { id: 'x', isAI: true, aiPersonality: 'crazyFrog', chips: 30 }, { id: 'y', isAI: true, aiPersonality: 'aggressiveFox', chips: 5 }], { solo: true, startingChips: 500 });
    for (let i = 0; i < 25; i++) {
      run(c, () => c.engine.phase === 'betting');
      expect(c.nextWakeAt()).toBeNull(); // 只有 AI 下注时不会自己发牌
      expect(c.engine.getPlayer('y')!.bet).toBeGreaterThan(0);
      c.handle('me', { type: 'bet', amount: 10 });
      run(c, () => c.engine.phase === 'round-end' || (c.engine.phase === 'player-turn' && c.engine.current!.playerId === 'me'));
      while (c.engine.phase === 'player-turn' && c.engine.current!.playerId === 'me') {
        c.handle('me', { type: 'stand' }, { token: c.engine.token });
        run(c, () => c.engine.phase === 'round-end' || (c.engine.phase === 'player-turn' && c.engine.current!.playerId === 'me'));
      }
      expect(c.engine.phase).toBe('round-end');
      c.handle('me', { type: 'next' });
    }
  });

  it('BJ-54 筹码用完：可以补给，还够时拒绝；持久金币由外部提供，每局开始前校正', () => {
    const c = ctrl([{ id: 'me', chips: 15 }], { solo: true, startingChips: 400 });
    run(c, () => c.engine.phase === 'betting');
    expect(c.handle('me', { type: 'rebuy' })).toBe('筹码还够，不需要补充');
    force(c, 'loss');
    c.handle('me', { type: 'bet', amount: 15 });
    run(c, () => c.engine.phase === 'player-turn');
    c.handle('me', { type: 'stand' });
    run(c, () => c.engine.phase === 'round-end');
    c.handle('me', { type: 'next' });
    run(c, () => c.engine.phase === 'betting');
    expect(c.handle('me', { type: 'bet', amount: 10 })).toBe('金币不足');
    expect(c.handle('me', { type: 'rebuy' })).toBeNull();
    expect(c.getView('me').players[0].balance).toBe(400);
    let wallet = 777;
    const p = ctrl([{ id: 'me', chips: 1 }], { solo: true, economy: 'profile' }, { balanceOf: () => wallet, refill: () => (wallet = 500) });
    run(p, () => p.engine.phase === 'betting');
    expect(p.getView('me').players[0].balance).toBe(777);
  });

  it('BJ-55 多人桌结束后自动开下一局；没人在线时停住，有人回来再继续', () => {
    const c = ctrl([{ id: 'a' }, { id: 'b' }]);
    run(c, () => c.engine.phase === 'betting');
    force(c, 'loss', 0, 2);
    c.handle('a', { type: 'bet', amount: 20 });
    c.handle('b', { type: 'bet', amount: 20 });
    run(c, () => c.engine.phase === 'round-end');
    expect(c.getView('a').nextRoundAt).not.toBeNull();
    run(c, () => c.engine.phase === 'betting');
    expect(c.engine.round).toBe(2);
    c.handle('a', { type: 'bet', amount: 20 });
    c.setConnected('b', false);
    run(c, () => c.engine.phase === 'player-turn' || c.engine.phase === 'dealer-turn');
    c.setConnected('a', false);
    run(c, () => c.engine.phase === 'round-end');
    expect(c.nextWakeAt()).toBeNull();
    c.setConnected('a', true);
    expect(c.nextWakeAt()).not.toBeNull();
  });

  it('BJ-56 保存到共享存储再恢复：计时、令牌、暗牌、余额都保留，可以继续打完', () => {
    const c = ctrl([{ id: 'a' }, { id: 'b' }]);
    run(c, () => c.engine.phase === 'betting');
    force(c, 'win', 0, 2);
    c.handle('a', { type: 'bet', amount: 20 });
    c.handle('b', { type: 'bet', amount: 20 });
    run(c, () => c.engine.phase === 'player-turn');
    const before = c.getView('a');
    const d = BlackjackController.fromState(JSON.parse(JSON.stringify(c.toState())));
    const after = d.getView('a');
    expect({ ...after, serverTime: 0 }).toEqual({ ...JSON.parse(JSON.stringify(before)), serverTime: 0 });
    expect(d.nextWakeAt()).toBe(c.nextWakeAt());
    expect(d.handle('a', { type: 'stand' }, { token: before.token })).toBeNull();
    run(d, () => d.engine.phase === 'round-end');
    expect(d.getView('a').players[0].hands[0].result).toBe('win');
  });

  it('BJ-57 玩家离开：轮到的人离开就轮到下一位；旁人离开不重新计时；结算只发生一次', () => {
    let n = 0;
    const c = ctrl([{ id: 'a' }, { id: 'b' }, { id: 'd' }], { turnTimeMs: 20000 }, { onRound: () => n++ });
    run(c, () => c.engine.phase === 'betting');
    const s = c.engine.toState();
    c.engine = BlackjackEngine.fromState({ ...s, shoe: rigNext(s.shoe, ['9d', '2s', '3s', '4s', '7c', '2h', '3h', '4h']) }, seededRandom(3));
    for (const id of ['a', 'b', 'd']) c.handle(id, { type: 'bet', amount: 20 });
    run(c, () => c.engine.phase === 'player-turn');
    const dl = c.getView('a').turnDeadline;
    c.removePlayer('d');
    expect(c.getView('a').turnDeadline).toBe(dl);
    c.removePlayer('a');
    expect(c.engine.current!.playerId).toBe('b');
    c.removePlayer('b');
    run(c, () => c.engine.phase === 'round-end');
    expect(n).toBe(1);
    expect(c.betweenRounds()).toBe(true);
  });

  it('BJ-58 不同性格的庄家用同一副牌：发出的牌、结果、赔付完全一样（性格不影响牌）', () => {
    const outs = DEALERS.map((d) => {
      const c = ctrl([{ id: 'me' }], { solo: true, dealer: pickDealer(d.species, () => 0), rng: seededRandom(404), aiRng: seededRandom(d.species.length) });
      const log: string[] = [];
      for (let i = 0; i < 8; i++) {
        run(c, () => c.engine.phase === 'betting');
        c.handle('me', { type: 'bet', amount: 10 });
        run(c, () => c.engine.phase === 'player-turn' || c.engine.phase === 'round-end');
        while (c.engine.phase === 'player-turn') c.handle('me', { type: 'stand' });
        run(c, () => c.engine.phase === 'round-end');
        log.push([...c.engine.dealer, ...c.engine.players[0].hands[0].cards].map((x) => x.uid).join(',') + c.engine.players[0].balance);
        c.handle('me', { type: 'next' });
      }
      return log.join('|');
    });
    expect(new Set(outs).size).toBe(1);
  });
});

describe('台词与庄家', () => {
  it('BJ-59 每种说话风格都有全部 21 点台词；庄家停牌会报点数；真人玩家的动物只在重大时刻开口', () => {
    for (const [style, t] of Object.entries(BJ_DIALOGUE)) {
      for (const [k, lines] of Object.entries(t)) expect(lines.length, `${style}.${k}`).toBeGreaterThan(0);
      expect(t.bjd_stand.some((l) => l.text.includes('{v}'))).toBe(true);
      expect(DIALOGUE[style as keyof typeof DIALOGUE].raise?.length).toBeGreaterThan(0);
    }
    expect(pickLine({ id: 'x', species: 'wolf', isAI: true }, 'bjd_stand', () => 0)!.ref.id).toBe('cool.bjd_stand.0');
    const said: [string, string][] = [];
    const c = ctrl([{ id: 'me' }], { solo: true, aiRng: () => 0.01 }, { onChat: (id, text) => said.push([id, text]) });
    for (const kind of ['loss', 'win', 'push', 'blackjack', 'dealer-blackjack'] as const) {
      run(c, () => c.engine.phase === 'betting');
      force(c, kind);
      c.handle('me', { type: 'bet', amount: 10 });
      run(c, () => c.engine.phase === 'player-turn' || c.engine.phase === 'round-end');
      if (c.engine.phase === 'player-turn') c.handle('me', { type: 'stand' });
      run(c, () => c.engine.phase === 'round-end');
      c.handle('me', { type: 'next' });
    }
    expect(said.some(([id]) => id === 'dealer')).toBe(true);
    expect(said.every(([, t]) => !t.includes('{v}'))).toBe(true);
  });
  it('BJ-60 庄家选择：只接受已有的动物；随机选择也在名单内', () => {
    expect(isDealerChoice('auto')).toBe(true);
    expect(isDealerChoice('constructor')).toBe(false);
    expect(DEALERS.map((d) => d.species)).toContain(pickDealer('auto', () => 0.99).profile.animal.species);
    expect(pickDealer('fox', Math.random).profile.animal.species).toBe('fox');
  });
});
