import { describe, it, expect } from 'vitest';
import { Deck } from '../src/core/cards/deck';
import { parseCards } from '../src/core/cards/card';
import { evaluateHand, HandCategory } from '../src/core/poker/handEvaluator';
import { seededRandom } from '../src/core/utils/random';

const ev = (s: string) => evaluateHand(parseCards(s));

describe('牌组', () => {
  it('生成 52 张不重复的牌，每张都有花色、点数和唯一 ID', () => {
    const d = new Deck();
    expect(d.remaining).toBe(52);
    const cards = d.peekAll();
    expect(new Set(cards.map((c) => c.id)).size).toBe(52);
    for (const c of cards) {
      expect(['s', 'h', 'd', 'c']).toContain(c.suit);
      expect(c.rank).toBeGreaterThanOrEqual(2);
      expect(c.rank).toBeLessThanOrEqual(14);
    }
  });

  it('洗牌会改变顺序且保持 52 张', () => {
    const d = new Deck(seededRandom(42));
    const before = d.peekAll().map((c) => c.id).join();
    d.shuffle();
    const after = d.peekAll().map((c) => c.id).join();
    expect(after).not.toBe(before);
    expect(new Set(d.peekAll().map((c) => c.id)).size).toBe(52);
  });

  it('洗牌分布大致均匀', () => {
    const rng = seededRandom(7);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const d = new Deck(rng);
      d.shuffle();
      const top = d.deal().id;
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    for (const v of counts.values()) expect(v).toBeGreaterThan(30); // 期望 ≈ 77
  });

  it('发牌、回收与重置', () => {
    const d = new Deck(seededRandom(1));
    d.shuffle();
    const hand = d.dealMany(5);
    expect(hand).toHaveLength(5);
    expect(d.remaining).toBe(47);
    expect(d.dealtCount).toBe(5);
    d.collect();
    expect(d.remaining).toBe(52);
    d.dealMany(52);
    expect(() => d.deal()).toThrow();
    d.reset();
    expect(d.remaining).toBe(52);
  });
});

describe('牌型判定', () => {
  it('高牌', () => {
    const r = ev('As Kd 9h 7c 4s 3d 2h');
    expect(r.category).toBe(HandCategory.HighCard);
    expect(r.ranks).toEqual([14, 13, 9, 7, 4]);
  });
  it('一对', () => {
    const r = ev('As Ad 9h 7c 4s 3d 2h');
    expect(r.category).toBe(HandCategory.OnePair);
    expect(r.ranks).toEqual([14, 14, 9, 7, 4]);
    expect(r.name).toBe('一对');
  });
  it('两对（三对时取最大两对，踢脚取剩余最大）', () => {
    const r = ev('As Ad 9h 9c 4s 4d Kh');
    expect(r.category).toBe(HandCategory.TwoPair);
    expect(r.ranks).toEqual([14, 14, 9, 9, 13]);
    const r2 = ev('Qs Qd 9h 9c 4s 4d 2h');
    expect(r2.ranks).toEqual([12, 12, 9, 9, 4]);
  });
  it('三条', () => {
    const r = ev('7s 7d 7h Kc 4s 3d 2h');
    expect(r.category).toBe(HandCategory.ThreeOfAKind);
    expect(r.ranks).toEqual([7, 7, 7, 13, 4]);
  });
  it('顺子（含 A-2-3-4-5 轮子）', () => {
    expect(ev('9s 8d 7h 6c 5s Kd 2h').category).toBe(HandCategory.Straight);
    const wheel = ev('As 2d 3h 4c 5s Kd 9h');
    expect(wheel.category).toBe(HandCategory.Straight);
    expect(wheel.ranks[0]).toBe(5);
    const broadway = ev('As Kd Qh Jc Ts 2d 3h');
    expect(broadway.ranks[0]).toBe(14);
    expect(broadway.score).toBeGreaterThan(wheel.score);
  });
  it('同花', () => {
    const r = ev('Ah 9h 7h 4h 2h Kd Ks');
    expect(r.category).toBe(HandCategory.Flush);
    expect(r.cards.every((c) => c.suit === 'h')).toBe(true);
  });
  it('葫芦（两组三条取大）', () => {
    const r = ev('Ks Kd Kh 4c 4s 2d 3h');
    expect(r.category).toBe(HandCategory.FullHouse);
    const r2 = ev('2s 2d 2h 9c 9s 9d Ah');
    expect(r2.category).toBe(HandCategory.FullHouse);
    expect(r2.ranks).toEqual([9, 9, 9, 2, 2]);
  });
  it('四条', () => {
    const r = ev('9s 9d 9h 9c As 2d 3h');
    expect(r.category).toBe(HandCategory.FourOfAKind);
    expect(r.ranks).toEqual([9, 9, 9, 9, 14]);
  });
  it('同花顺', () => {
    const r = ev('9h 8h 7h 6h 5h Ad Ks');
    expect(r.category).toBe(HandCategory.StraightFlush);
    const steelWheel = ev('Ah 2h 3h 4h 5h Kd Ks');
    expect(steelWheel.category).toBe(HandCategory.StraightFlush);
    expect(steelWheel.ranks[0]).toBe(5);
  });
  it('皇家同花顺', () => {
    const r = ev('Ah Kh Qh Jh Th 2d 3s');
    expect(r.category).toBe(HandCategory.RoyalFlush);
    expect(r.name).toBe('皇家同花顺');
  });
  it('同花顺优先于同花（7 张中同花但非同花顺部分更大）', () => {
    const r = ev('2h 3h 4h 5h 6h Ah Kh');
    expect(r.category).toBe(HandCategory.StraightFlush);
    expect(r.ranks[0]).toBe(6);
  });
  it('牌型大小顺序正确', () => {
    const order = [
      'As Kd 9h 7c 4s',
      'As Ad 9h 7c 4s',
      'As Ad 9h 9c 4s',
      'As Ad Ah 7c 4s',
      '9s 8d 7h 6c 5s',
      'Ah 9h 7h 4h 2h',
      'Ks Kd Kh 4c 4s',
      '9s 9d 9h 9c As',
      '9h 8h 7h 6h 5h',
      'Ah Kh Qh Jh Th',
    ].map(ev);
    for (let i = 1; i < order.length; i++) expect(order[i].score).toBeGreaterThan(order[i - 1].score);
  });
  it('平局与踢脚比较', () => {
    // 公共牌成顺子，两人平分
    const a = ev('2c 3d 9s Ts Jd Qh Kc');
    const b = ev('2h 4d 9s Ts Jd Qh Kc');
    expect(a.score).toBe(b.score);
    // 踢脚决定胜负
    const c = ev('Ah Kd As 7c 4s 3d 2h');
    const d = ev('Ah Qd As 7c 4s 3d 2h');
    expect(c.score).toBeGreaterThan(d.score);
    // 同花色无关
    expect(ev('Ah Kh Qh Jh 9h').score).toBe(ev('As Ks Qs Js 9s').score);
  });
});
