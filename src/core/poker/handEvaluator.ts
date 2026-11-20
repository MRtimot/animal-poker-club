import { Card, Rank, Suit } from '../cards/card';

/** 牌型等级（数值越大越强） */
export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export const HAND_NAME: Record<HandCategory, string> = {
  [HandCategory.HighCard]: '高牌',
  [HandCategory.OnePair]: '一对',
  [HandCategory.TwoPair]: '两对',
  [HandCategory.ThreeOfAKind]: '三条',
  [HandCategory.Straight]: '顺子',
  [HandCategory.Flush]: '同花',
  [HandCategory.FullHouse]: '葫芦',
  [HandCategory.FourOfAKind]: '四条',
  [HandCategory.StraightFlush]: '同花顺',
  [HandCategory.RoyalFlush]: '皇家同花顺',
};

export interface HandResult {
  category: HandCategory;
  name: string;
  /** 用于比较的数值：越大越强，相同即平局 */
  score: number;
  /** 比较用的点数序列（主牌在前，踢脚在后） */
  ranks: Rank[];
  /** 组成最佳五张牌的具体牌 */
  cards: Card[];
}

function encode(category: HandCategory, ranks: number[]): number {
  let s = category;
  for (let i = 0; i < 5; i++) s = s * 16 + (ranks[i] ?? 0);
  return s;
}

/** 在点数集合中寻找最高顺子，返回顶张点数（A-2-3-4-5 返回 5），无则 0 */
function findStraightHigh(rankSet: Set<number>): number {
  for (let high = 14; high >= 5; high--) {
    let ok = true;
    for (let k = 0; k < 5; k++) {
      let r = high - k;
      if (r === 1) r = 14; // A 作为 1
      if (!rankSet.has(r)) {
        ok = false;
        break;
      }
    }
    if (ok) return high;
  }
  return 0;
}

function straightRanks(high: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 5; k++) {
    const r = high - k;
    out.push(r === 1 ? 14 : r);
  }
  return out;
}

/** 按点数从牌堆里挑出若干张（不重复） */
function takeByRanks(pool: Card[], ranks: number[]): Card[] {
  const used = new Set<string>();
  const out: Card[] = [];
  for (const r of ranks) {
    const c = pool.find((x) => x.rank === r && !used.has(x.id));
    if (c) {
      used.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/**
 * 评估 5～7 张牌中的最佳五张牌型。
 * 直接分析点数 / 花色分布，不做 21 种组合枚举，速度足够用于 AI 蒙特卡洛模拟。
 */
export function evaluateHand(cards: Card[]): HandResult {
  if (cards.length < 5 || cards.length > 7) throw new Error('评估牌型需要 5～7 张牌');

  const counts = new Map<number, number>();
  const bySuit: Record<Suit, Card[]> = { s: [], h: [], d: [], c: [] };
  for (const c of cards) {
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    bySuit[c.suit].push(c);
  }

  // 同花 / 同花顺
  let flushCards: Card[] | null = null;
  for (const s of ['s', 'h', 'd', 'c'] as Suit[]) {
    if (bySuit[s].length >= 5) flushCards = bySuit[s];
  }
  if (flushCards) {
    const set = new Set(flushCards.map((c) => c.rank as number));
    const sfHigh = findStraightHigh(set);
    if (sfHigh) {
      const ranks = straightRanks(sfHigh);
      const cat = sfHigh === 14 ? HandCategory.RoyalFlush : HandCategory.StraightFlush;
      return {
        category: cat,
        name: HAND_NAME[cat],
        score: encode(cat, [sfHigh]),
        ranks: ranks as Rank[],
        cards: takeByRanks(flushCards, ranks),
      };
    }
  }

  // 按 (张数, 点数) 降序排列的点数分组
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const sortedRanksDesc = [...counts.keys()].sort((a, b) => b - a);

  // 四条
  if (groups[0][1] === 4) {
    const quad = groups[0][0];
    const kicker = sortedRanksDesc.find((r) => r !== quad)!;
    const ranks = [quad, quad, quad, quad, kicker];
    return {
      category: HandCategory.FourOfAKind,
      name: HAND_NAME[HandCategory.FourOfAKind],
      score: encode(HandCategory.FourOfAKind, [quad, kicker]),
      ranks: ranks as Rank[],
      cards: takeByRanks(cards, ranks),
    };
  }

  // 葫芦
  if (groups[0][1] === 3) {
    const trips = groups[0][0];
    const pair = groups.slice(1).find((g) => g[1] >= 2)?.[0];
    if (pair !== undefined) {
      const ranks = [trips, trips, trips, pair, pair];
      return {
        category: HandCategory.FullHouse,
        name: HAND_NAME[HandCategory.FullHouse],
        score: encode(HandCategory.FullHouse, [trips, pair]),
        ranks: ranks as Rank[],
        cards: takeByRanks(cards, ranks),
      };
    }
  }

  // 同花
  if (flushCards) {
    const top = flushCards.map((c) => c.rank as number).sort((a, b) => b - a).slice(0, 5);
    return {
      category: HandCategory.Flush,
      name: HAND_NAME[HandCategory.Flush],
      score: encode(HandCategory.Flush, top),
      ranks: top as Rank[],
      cards: takeByRanks(flushCards, top),
    };
  }

  // 顺子
  const stHigh = findStraightHigh(new Set(counts.keys()));
  if (stHigh) {
    const ranks = straightRanks(stHigh);
    return {
      category: HandCategory.Straight,
      name: HAND_NAME[HandCategory.Straight],
      score: encode(HandCategory.Straight, [stHigh]),
      ranks: ranks as Rank[],
      cards: takeByRanks(cards, ranks),
    };
  }

  // 三条
  if (groups[0][1] === 3) {
    const trips = groups[0][0];
    const kickers = sortedRanksDesc.filter((r) => r !== trips).slice(0, 2);
    const ranks = [trips, trips, trips, ...kickers];
    return {
      category: HandCategory.ThreeOfAKind,
      name: HAND_NAME[HandCategory.ThreeOfAKind],
      score: encode(HandCategory.ThreeOfAKind, [trips, ...kickers]),
      ranks: ranks as Rank[],
      cards: takeByRanks(cards, ranks),
    };
  }

  // 两对
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const hi = groups[0][0];
    const lo = groups[1][0];
    const kicker = sortedRanksDesc.find((r) => r !== hi && r !== lo)!;
    const ranks = [hi, hi, lo, lo, kicker];
    return {
      category: HandCategory.TwoPair,
      name: HAND_NAME[HandCategory.TwoPair],
      score: encode(HandCategory.TwoPair, [hi, lo, kicker]),
      ranks: ranks as Rank[],
      cards: takeByRanks(cards, ranks),
    };
  }

  // 一对
  if (groups[0][1] === 2) {
    const pair = groups[0][0];
    const kickers = sortedRanksDesc.filter((r) => r !== pair).slice(0, 3);
    const ranks = [pair, pair, ...kickers];
    return {
      category: HandCategory.OnePair,
      name: HAND_NAME[HandCategory.OnePair],
      score: encode(HandCategory.OnePair, [pair, ...kickers]),
      ranks: ranks as Rank[],
      cards: takeByRanks(cards, ranks),
    };
  }

  // 高牌
  const top = sortedRanksDesc.slice(0, 5);
  return {
    category: HandCategory.HighCard,
    name: HAND_NAME[HandCategory.HighCard],
    score: encode(HandCategory.HighCard, top),
    ranks: top as Rank[],
    cards: takeByRanks(cards, top),
  };
}

/** 比较两手牌：>0 表示 a 更强，<0 表示 b 更强，0 平局 */
export function compareHands(a: HandResult, b: HandResult): number {
  return a.score - b.score;
}

/** 在若干玩家中找出赢家（可能多人平分） */
export function findWinners<T extends { hand: HandResult }>(entries: T[]): T[] {
  let best = -1;
  let winners: T[] = [];
  for (const e of entries) {
    if (e.hand.score > best) {
      best = e.hand.score;
      winners = [e];
    } else if (e.hand.score === best) {
      winners.push(e);
    }
  }
  return winners;
}

/** 少于 5 张牌时（翻牌前）给出简易描述 */
export function describePartial(cards: Card[]): string {
  if (cards.length >= 5) return evaluateHand(cards).name;
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const max = Math.max(...counts.values());
  if (max >= 4) return HAND_NAME[HandCategory.FourOfAKind];
  if (max === 3) return HAND_NAME[HandCategory.ThreeOfAKind];
  if (max === 2) {
    const pairs = [...counts.values()].filter((v) => v === 2).length;
    return HAND_NAME[pairs >= 2 ? HandCategory.TwoPair : HandCategory.OnePair];
  }
  return HAND_NAME[HandCategory.HighCard];
}
