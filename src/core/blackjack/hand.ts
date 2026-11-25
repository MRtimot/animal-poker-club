// 21 点手牌计算（纯函数）：A 自动取 1 或 11，区分软 / 硬点数，区分“天生 21 点”与普通 21 点
import type { Card } from '../cards/card';

export interface HandValue {
  value: number;
  /** 有一张 A 正按 11 计算 */
  soft: boolean;
  /** 最初两张牌：A + 10 点牌（分牌后的两张 21 点不算） */
  blackjack: boolean;
  bust: boolean;
}

type RankOnly = Pick<Card, 'rank'>;

/** 10、J、Q、K */
export const isTenValue = (c: RankOnly) => c.rank >= 10 && c.rank <= 13;
export const isAce = (c: RankOnly) => c.rank === 14;

/** 单张牌的点数（A 记 11，用于显示庄家明牌与分牌比较） */
export function cardPoints(c: RankOnly): number {
  return isAce(c) ? 11 : isTenValue(c) ? 10 : c.rank;
}

/** 最佳点数：先把 A 全部当 1，能把其中一张升为 11 而不爆牌时才升（最多只可能有一张 A 当 11） */
export function evaluateBlackjack(cards: readonly RankOnly[], fromSplit = false): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (isAce(c)) {
      aces++;
      total += 1;
    } else total += Math.min(10, c.rank);
  }
  const soft = aces > 0 && total + 10 <= 21;
  if (soft) total += 10;
  const natural = cards.length === 2 && cards.some(isAce) && cards.some(isTenValue);
  return { value: total, soft, blackjack: natural && !fromSplit, bust: total > 21 };
}

/** 界面文字：软点数写成 “7 / 17” */
export function valueText(v: HandValue): string {
  if (v.blackjack) return '21';
  return v.soft && v.value < 21 ? `${v.value - 10} / ${v.value}` : String(v.value);
}
