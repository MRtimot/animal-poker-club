// 扑克牌基础类型 —— 与 UI / 网络完全无关的纯逻辑

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  /** 唯一 ID，例如 "As"、"Th"、"2c" */
  id: string;
  suit: Suit;
  rank: Rank;
}

export const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAME: Record<Suit, string> = { s: '黑桃', h: '红心', d: '方块', c: '梅花' };

const RANK_CHAR: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const CHAR_RANK: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

export function rankLabel(rank: Rank): string {
  return rank === 10 ? '10' : RANK_CHAR[rank];
}

export function cardId(rank: Rank, suit: Suit): string {
  return RANK_CHAR[rank] + suit;
}

export function makeCard(rank: Rank, suit: Suit): Card {
  return { id: cardId(rank, suit), rank, suit };
}

/** 从 "As" / "Td" / "10h" 这类字符串解析一张牌（主要用于测试） */
export function parseCard(s: string): Card {
  const str = s.trim();
  const suit = str.slice(-1).toLowerCase() as Suit;
  let r = str.slice(0, -1).toUpperCase();
  if (r === '10') r = 'T';
  const rank = CHAR_RANK[r];
  if (!rank || !SUITS.includes(suit)) throw new Error(`无效的牌：${s}`);
  return makeCard(rank, suit);
}

export function parseCards(s: string): Card[] {
  return s.split(/\s+/).filter(Boolean).map(parseCard);
}

export function cardToText(c: Card): string {
  return SUIT_SYMBOL[c.suit] + rankLabel(c.rank);
}

export function isRed(c: Card | Suit): boolean {
  const suit = typeof c === 'string' ? c : c.suit;
  return suit === 'h' || suit === 'd';
}
