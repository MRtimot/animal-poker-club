import { Card } from '../cards/card';
import { Deck } from '../cards/deck';
import { evaluateHand } from '../poker/handEvaluator';
import { RNG } from '../utils/random';

/**
 * 蒙特卡洛估算胜率：随机发出对手底牌与剩余公共牌，统计获胜比例（平局按人数平分）。
 * 纯本地计算，不依赖任何外部服务。
 */
export function estimateEquity(hole: Card[], board: Card[], opponents: number, iterations: number, rng: RNG): number {
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...board].map((c) => c.id));
  const pool = Deck.fullDeck().filter((c) => !known.has(c.id));
  const needBoard = 5 - board.length;
  let score = 0;

  for (let it = 0; it < iterations; it++) {
    // 部分 Fisher-Yates：只洗出需要的张数
    const need = needBoard + opponents * 2;
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    const fullBoard = board.concat(pool.slice(0, needBoard));
    const mine = evaluateHand(hole.concat(fullBoard)).score;
    let best = 0;
    let tiedWithMe = 0;
    let lost = false;
    for (let o = 0; o < opponents; o++) {
      const off = needBoard + o * 2;
      const s = evaluateHand([pool[off], pool[off + 1], ...fullBoard]).score;
      if (s > mine) {
        lost = true;
        break;
      }
      if (s === mine) tiedWithMe++;
      if (s > best) best = s;
    }
    if (!lost) score += tiedWithMe ? 1 / (tiedWithMe + 1) : 1;
  }
  return score / iterations;
}

/** 翻牌前快速评分（Chen 公式归一化到 0~1），供简单难度或作为先验使用 */
export function preflopStrength(hole: Card[]): number {
  const [a, b] = hole[0].rank >= hole[1].rank ? hole : [hole[1], hole[0]];
  const base: Record<number, number> = { 14: 10, 13: 8, 12: 7, 11: 6 };
  let s = base[a.rank] ?? a.rank / 2;
  if (a.rank === b.rank) s = Math.max(5, s * 2);
  if (a.suit === b.suit) s += 2;
  const gap = a.rank - b.rank - 1;
  if (a.rank !== b.rank) {
    if (gap === 1) s -= 1;
    else if (gap === 2) s -= 2;
    else if (gap === 3) s -= 4;
    else if (gap >= 4) s -= 5;
    if (gap <= 1 && a.rank < 12) s += 1;
  }
  return Math.max(0, Math.min(1, (s + 1) / 21));
}
