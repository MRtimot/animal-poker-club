// 21 点 V1 规则锁定：规格里的每个例子都经过真正的引擎。改动规则会让这里失败。
import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/core/cards/card';
import { BlackjackEngine } from '../src/core/blackjack/engine';
import { evaluateBlackjack } from '../src/core/blackjack/hand';
import { DEFAULT_RULES, cleanRules } from '../src/core/blackjack/rules';
import { BJ_ACTIONS, type BjAction } from '../src/core/blackjack/types';
import { rigNext } from '../src/core/blackjack/debug';
import { basicStrategy } from '../src/core/blackjack/strategy';
import { seededRandom } from '../src/core/utils/random';

/** cards：庄家明牌 → 玩家们 → 庄家暗牌 → 玩家们 → 后续 */
function table(cards: string, n = 1, balance = 1000) {
  let e = new BlackjackEngine({}, seededRandom(5));
  for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'P' + i, balance);
  e.openBetting();
  for (let i = 0; i < n; i++) e.placeBet('p' + i, 100);
  const s = e.toState();
  e = BlackjackEngine.fromState({ ...s, shoe: rigNext(s.shoe, cards.split(' ')) }, seededRandom(9));
  e.deal();
  e.beginTurns();
  return e;
}
const finish = (e: BlackjackEngine) => {
  for (let i = 0; i < 30 && e.phase === 'dealer-turn'; i++) e.dealerStep();
  expect(e.phase).toBe('round-end');
  return e;
};
const out = (e: BlackjackEngine, id = 'p0') => [e.getPlayer(id)!.hands.map((h) => h.result).join(), e.getPlayer(id)!.balance];
const allRejected = (e: BlackjackEngine) => {
  const before = JSON.stringify(e.toState());
  for (const a of BJ_ACTIONS) expect(() => e.act('p0', a)).toThrow();
  expect(e.getLegal('p0')).toBeNull();
  expect(JSON.stringify(e.toState())).toBe(before);
};

describe('21 点 V1 规则锁定', () => {
  it.each([
    ['As', 11, true, false], ['As 5d', 16, true, false], ['As 6d', 17, true, false], ['As 9d', 20, true, false],
    ['As Kd', 21, true, true], ['As Td', 21, true, true], ['As Jd', 21, true, true], ['As Qd', 21, true, true],
    ['As 5d 5c', 21, true, false], ['As 6d Tc', 17, false, false], ['As Ad', 12, true, false],
    ['As Ad 9c', 21, true, false], ['As Ad 9c 5h', 16, false, false], ['7s 4d Tc', 21, false, false],
  ])('LOCK-01 %s = %i 软 %s 黑杰克 %s', (c, value, soft, blackjack) => {
    expect(evaluateBlackjack(parseCards(c as string))).toMatchObject({ value, soft, blackjack });
  });

  it.each([
    ['16 要牌', 'Td 6c', 3], ['17 停牌', 'Td 7c', 2], ['软 17 停牌', 'Ad 6c', 2], ['18 停牌', 'Td 8c', 2],
    ['软 16 要牌', 'Ad 5c', 3],
  ])('LOCK-02 庄家 %s', (_n, dealer, count) => {
    const [up, hole] = (dealer as string).split(' ');
    const e = table(`${up} Ts ${hole} 9h 2s`);
    e.act('p0', 'stand');
    finish(e);
    expect(e.dealer.length).toBeGreaterThanOrEqual(count as number);
    if (count === 2) expect(e.dealer.length).toBe(2);
  });
  it('LOCK-03 庄家 21 停牌；22 爆牌，所有没爆的玩家赢', () => {
    const s = table('Td Ts 6c 9h 5s');
    s.act('p0', 'stand');
    expect([finish(s).dealer.length, ...out(s)]).toEqual([3, 'lose', 900]);
    const b = table('Td Ts 9s 6c 8h 7h 6s', 2);
    b.act('p0', 'stand');
    b.act('p1', 'stand');
    finish(b);
    expect([evaluateBlackjack(b.dealer).value, out(b), out(b, 'p1')]).toEqual([22, ['win', 1100], ['win', 1100]]);
  });

  it('LOCK-04 黑杰克对照表（赔率与余额）', () => {
    expect(out(finish(table('9d As Tc Kh')))).toEqual(['blackjack', 1150]); // 庄家 19
    expect(out(finish(table('Ad As Kc Kh')))).toEqual(['push', 1000]);
    // 玩家黑杰克 vs 庄家普通 21：同桌另一位还活着，庄家才会补到 21
    const m = table('6d As Ts Tc Kh 9h 5s', 2);
    m.act('p1', 'stand');
    finish(m);
    expect([evaluateBlackjack(m.dealer), out(m), out(m, 'p1')]).toMatchObject([{ value: 21, blackjack: false }, ['blackjack', 1150], ['lose', 900]]);
    // 普通 21 vs 普通 21
    const p = table('6d 7s Tc 4h Th 5s');
    p.act('p0', 'hit');
    expect(out(finish(p))).toEqual(['push', 1000]);
  });
  it('LOCK-05 普通 21 输给庄家黑杰克（分牌后的 A + K、三张 21 都算普通 21）', () => {
    // 庄家明牌 A / 10 会先看暗牌，玩家没有机会补到 21，所以直接构造结算状态
    const e = table('6d 7s Tc 4h Th');
    e.act('p0', 'hit');
    e.dealer = parseCards('Ad Kc').map((c, i) => ({ ...c, uid: `${c.id}-${i}` }));
    expect(out(finish(e))).toEqual(['dealer-blackjack', 900]);
  });
  it('LOCK-06 任何一方初始黑杰克结束这一手后，四种操作全部拒绝且状态不变', () => {
    allRejected(table('9d As Tc Kh'));
    allRejected(table('Ad Ts Kc 9h'));
    allRejected(table('Kd Ts Ac 9h'));
  });
  it('LOCK-07 爆牌：立即输，四种操作全部拒绝', () => {
    const e = table('7d Ts 9c 8h 5s');
    e.act('p0', 'hit');
    allRejected(e);
    expect(out(finish(e))).toEqual(['bust', 900]);
    allRejected(e);
  });
  it('LOCK-08 要牌到 21 自动停；停牌后全部拒绝', () => {
    const e = table('9d 7s 9c 4h Th');
    e.act('p0', 'hit');
    allRejected(e);
    expect(out(finish(e))).toEqual(['win', 1100]);
    const s = table('9d Ts 9c 8h');
    s.act('p0', 'stand');
    allRejected(s);
  });
  it('LOCK-09 加倍 8 + 3：下注 ×2、恰好一张、自动停牌、不能再行动', () => {
    const e = table('6d 8s Tc 3h 9s Ks');
    e.act('p0', 'double');
    expect(e.getPlayer('p0')!.hands[0]).toMatchObject({ bet: 200, doubled: true, done: true });
    expect(e.getPlayer('p0')!.hands[0].cards.length).toBe(3);
    allRejected(e);
    expect(out(finish(e))).toEqual(['win', 1200]);
    const poor = table('6d 8s Tc 3h', 1, 150);
    const before = JSON.stringify(poor.toState());
    expect(() => poor.act('p0', 'double')).toThrow('金币不足');
    expect(JSON.stringify(poor.toState())).toBe(before);
  });
  it('LOCK-10 分牌：8+8 / K+K / A+A 可以；8+9、10+K、J+Q 不可以', () => {
    for (const [a, b, ok] of [['8s', '8h', true], ['Ks', 'Kh', true], ['As', 'Ah', true], ['8s', '9h', false], ['Ts', 'Kh', false], ['Js', 'Qh', false]] as const) expect(table(`6d ${a} Tc ${b}`).getLegal('p0')!.split).toBe(ok);
  });
  it('LOCK-11 分牌后两手独立：下注、顺序、结算；分牌的 A + K 只赔 1:1', () => {
    const e = table('6d As Tc Ah Kh 8c Ks');
    e.act('p0', 'split');
    expect(e.getPlayer('p0')!.hands.map((h) => [h.bet, h.cards.length, h.done])).toEqual([[100, 2, true], [100, 2, true]]);
    allRejected(e);
    expect(out(finish(e))).toEqual(['win,win', 1200]);
    const s = table('6d 8s Tc 8h 5s 9s Kc 9c');
    s.act('p0', 'split');
    s.act('p0', 'hit'); // 第一手 8+5+K 爆
    expect(s.getPlayer('p0')!.activeHand).toBe(1);
    s.act('p0', 'stand'); // 第二手 17；庄家 6+10+9 爆
    expect(out(finish(s))).toEqual(['bust,win', 1000]);
  });
  it('LOCK-12 只有四种操作；规则里没有保险 / 投降 / 边注', () => {
    expect([...BJ_ACTIONS].sort()).toEqual(['double', 'hit', 'split', 'stand']);
    const e = table('Ad Ts 6c 9h');
    for (const x of ['insurance', 'surrender', 'sidebet', 'perfectPairs', '21+3']) expect(() => e.act('p0', x as BjAction)).toThrow('未知操作');
    expect(Object.keys(DEFAULT_RULES).sort()).toEqual(['blackjackPayout', 'decks', 'maxBet', 'maxHands', 'minBet', 'penetration']);
  });
  it('LOCK-13 外部配置 / 旧牌局状态不能改变规则', () => {
    const old = { splitBy: 'value', maxHands: 4, doubleAfterSplit: true, dealerHitsSoft17: true, blackjackPayout: [6, 5], minBet: 20, maxBet: 400 };
    const r = cleanRules(old as unknown as Parameters<typeof cleanRules>[0]);
    expect(r).toEqual({ ...DEFAULT_RULES, minBet: 20, maxBet: 400 });
    const s = new BlackjackEngine({}, seededRandom(1)).toState();
    expect(BlackjackEngine.fromState({ ...s, rules: { ...s.rules, ...old } as unknown as typeof s.rules }).rules).toEqual(r);
  });
  it('LOCK-14 重复点击：同一令牌只执行一次；下一局全部清空', () => {
    const e = table('9d 2s 9c 2h 3s 3c');
    const t = e.token;
    e.act('p0', 'hit', t);
    const after = JSON.stringify(e.toState());
    for (let i = 0; i < 20; i++) for (const a of BJ_ACTIONS) expect(() => e.act('p0', a, t)).toThrow('已经处理过了');
    expect(JSON.stringify(e.toState())).toBe(after);
    e.act('p0', 'stand');
    finish(e);
    const id = e.roundId;
    e.openBetting();
    expect([e.dealer.length, e.holeRevealed, e.current, e.getPlayer('p0')!.hands.length, e.getPlayer('p0')!.bet]).toEqual([0, false, null, 0, 0]);
    expect(e.roundId).not.toBe(id);
    expect(e.events.every((x) => x.type === 'roundStart' || x.type === 'shuffle')).toBe(true);
  });
  it('LOCK-15 同桌 AI 的建议永远是引擎允许的操作', () => {
    const r = seededRandom(3);
    for (let i = 0; i < 2000; i++) {
      const e = new BlackjackEngine({}, r);
      e.addPlayer('a', 'A', 200);
      e.openBetting();
      e.placeBet('a', 100);
      e.deal();
      e.beginTurns();
      for (let l = e.getLegal('a'); l; l = e.getLegal('a')) {
        const a = basicStrategy(e.getPlayer('a')!.hands.find((h) => h.id === e.current!.handId)!.cards, Math.min(11, e.dealer[0].rank === 14 ? 11 : Math.min(10, e.dealer[0].rank)), l);
        expect(l[a]).toBe(true);
        e.act('a', a);
      }
    }
  });
});
