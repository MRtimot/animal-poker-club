// 21 点公平性核对（纯函数）：不使用引擎的结算代码，按规则从牌重新推算，用来检查引擎。
// 模拟（simulate.ts）、测试与开发调试面板共用。这里只读结果，从不参与发牌或结算。
import { RANKS, SUITS, type Card } from '../cards/card';
import { evaluateBlackjack } from './hand';
import type { HandResult } from './rules';

type HandCards = readonly Pick<Card, 'rank'>[];

/** 一张牌是否合法：点数、花色、编号 “As-0” 互相对得上 */
export function validCard(c: { id?: unknown; rank?: unknown; suit?: unknown; uid?: unknown }): boolean {
  if (!RANKS.includes(c.rank as never) || !SUITS.includes(c.suit as never)) return false;
  const label = ({ 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[c.rank as number] ?? String(c.rank);
  return c.id === label + c.suit && typeof c.uid === 'string' && new RegExp(`^${label}${c.suit}-\\d+$`).test(c.uid);
}

/** 一局里出现的实体牌有没有重复 */
export function duplicateCards(uids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const u of uids) (seen.has(u) ? dup : seen).add(u);
  return [...dup];
}

/** 按规则从牌推算一手的结果（不看引擎） */
export function expectedResult(hand: HandCards, fromSplit: boolean, dealer: HandCards): Exclude<HandResult, 'forfeit'> {
  const me = evaluateBlackjack(hand, fromSplit);
  const d = evaluateBlackjack(dealer);
  if (me.bust) return 'bust';
  if (me.blackjack) return d.blackjack ? 'push' : 'blackjack';
  if (d.blackjack) return 'dealer-blackjack';
  if (d.bust) return 'win';
  return me.value > d.value ? 'win' : me.value < d.value ? 'lose' : 'push';
}

/** 固定赔付表：返还总额（含本金）。黑杰克 3:2，盈利向下取整 */
export function expectedPayout(bet: number, result: HandResult): number {
  if (result === 'blackjack') return bet + Math.floor((bet * 3) / 2);
  if (result === 'win') return bet * 2;
  if (result === 'push') return bet;
  return 0;
}

/**
 * 庄家有没有按规则补牌：不足 17 才能要牌，17 及以上（含软 17）停牌。
 * live：还有没爆、不是黑杰克、没离桌的玩家手牌（没有时庄家只翻牌不补牌）
 */
export function dealerRuleProblem(dealer: HandCards, live: boolean): string | null {
  if (dealer.length < 2) return '庄家少于两张牌';
  for (let k = 2; k < dealer.length; k++) if (evaluateBlackjack(dealer.slice(0, k)).value >= 17) return `庄家 ${evaluateBlackjack(dealer.slice(0, k)).value} 点还在要牌`;
  const v = evaluateBlackjack(dealer);
  if (v.blackjack && dealer.length > 2) return '庄家黑杰克后还在要牌';
  if (!live && dealer.length > 2) return '没有需要比较的手牌，庄家却补了牌';
  if (live && !v.blackjack && !v.bust && v.value < 17) return `庄家 ${v.value} 点就停牌`;
  return null;
}

/** 玩家一手牌的动作是否可能：爆牌或到 21 之后不能再拿牌；加倍只多一张；分 A 只补一张 */
export function handProblem(h: { cards: HandCards; doubled: boolean; fromSplit: boolean }, hands: number): string | null {
  if (hands > 2) return `分成了 ${hands} 手`;
  for (let k = 2; k < h.cards.length; k++) if (evaluateBlackjack(h.cards.slice(0, k), h.fromSplit).value >= 21) return '到 21 或爆牌后还在拿牌';
  if (h.doubled && (h.fromSplit || h.cards.length !== 3)) return '加倍后的牌数不对';
  if (h.fromSplit && h.cards[0]?.rank === 14 && h.cards.length !== 2) return '分 A 后多拿了牌';
  return null;
}
