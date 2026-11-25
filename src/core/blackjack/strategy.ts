// 同桌 AI 动物的打法：基本策略（只看自己的牌和庄家明牌），按性格偶尔犯错。完全本地计算，不调用任何外部服务。
import type { AIPersonality } from '../ai/ai';
import type { RNG } from '../utils/random';
import { cardPoints, evaluateBlackjack, isAce } from './hand';
import type { BjCard } from './shoe';
import type { BjAction, BjLegal } from './types';

/** 基本策略。up：庄家明牌点数（A = 11） */
export function basicStrategy(cards: readonly Pick<BjCard, 'rank'>[], up: number, legal: BjLegal): BjAction {
  const v = evaluateBlackjack(cards, true);
  if (legal.split && cards.length === 2) {
    const pair = cardPoints(cards[0]);
    const yes =
      isAce(cards[0]) ||
      pair === 8 ||
      (pair === 9 && up !== 7 && up < 10) ||
      (pair === 7 && up <= 7) ||
      (pair === 6 && up <= 6) ||
      ((pair === 2 || pair === 3) && up <= 7);
    if (yes) return 'split';
  }
  if (v.soft) {
    if (v.value >= 19) return 'stand';
    if (v.value === 18) return legal.double && up >= 3 && up <= 6 ? 'double' : up >= 9 ? 'hit' : 'stand';
    return legal.double && (v.value === 17 ? up >= 3 && up <= 6 : up === 5 || up === 6) ? 'double' : 'hit';
  }
  if (v.value >= 17) return 'stand';
  if (v.value >= 13) return up <= 6 ? 'stand' : 'hit';
  if (v.value === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (legal.double && (v.value === 11 || (v.value === 10 && up <= 9) || (v.value === 9 && up >= 3 && up <= 6))) return 'double';
  return 'hit';
}

const MISTAKE: Record<AIPersonality, number> = { aggressiveFox: 0.12, cautiousPanda: 0.1, crazyFrog: 0.35, smartCat: 0.02, luckyRabbit: 0.2 };

export function aiAction(cards: readonly Pick<BjCard, 'rank'>[], up: number, legal: BjLegal, who: AIPersonality, rng: RNG): BjAction {
  const best = basicStrategy(cards, up, legal);
  if (rng() >= MISTAKE[who]) return best;
  const v = evaluateBlackjack(cards, true);
  // 犯错也像真人：激进的多要一张 / 乱加倍，保守的早停，绝不会在 17 点以上乱要牌
  if (who === 'cautiousPanda') return v.value >= 12 ? 'stand' : best;
  if (who === 'aggressiveFox' && legal.double && v.value >= 9 && v.value <= 11) return 'double';
  return v.value < 17 ? 'hit' : 'stand';
}

/** AI 动物的下注：按性格取最低下注的倍数，落在筹码面额上 */
export function aiBet(who: AIPersonality, min: number, max: number, balance: number, rng: RNG): number {
  const mult = who === 'aggressiveFox' ? 3 + Math.floor(rng() * 3) : who === 'crazyFrog' ? 1 + Math.floor(rng() * 6) : who === 'smartCat' ? 2 : who === 'luckyRabbit' ? 1 + Math.floor(rng() * 3) : 1;
  const cap = Math.min(max, balance);
  if (cap < min) return 0;
  return Math.max(min, Math.min(cap, min * mult));
}
