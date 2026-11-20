// 筹码拆分：写实筹码堆既要“看起来像真的”，金额也必须准确（在显示上限内）
import { describe, it, expect } from 'vitest';
import { breakdown, DENOMS } from '../src/three/chips/Chips';

describe('筹码堆拆分', () => {
  it('不超过上限时，拆分后的总额与金额完全一致', () => {
    for (const amt of [1, 7, 30, 125, 990, 1000, 3908, 12345]) {
      const cols = breakdown(amt, 999, 8);
      const sum = cols.reduce((a, c) => a + c.value * c.count, 0);
      expect(sum).toBe(amt);
      for (const c of cols) expect(DENOMS.some((d) => d.value === c.value)).toBe(true);
    }
  });
  it('大面额会被换成多枚小面额，让筹码堆有真实的高度', () => {
    const cols = breakdown(1000, 20, 12);
    const chips = cols.reduce((a, c) => a + c.count, 0);
    expect(chips).toBeGreaterThanOrEqual(10);
    for (const c of cols) expect(c.count).toBeLessThanOrEqual(20);
  });
  it('每列不超过上限，金额为 0 时没有筹码', () => {
    expect(breakdown(0)).toEqual([]);
    for (const c of breakdown(987654, 20, 12)) expect(c.count).toBeLessThanOrEqual(20);
  });
});
