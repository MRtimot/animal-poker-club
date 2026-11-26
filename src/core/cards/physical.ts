// 实体牌：牌面（点数 + 花色）加上“第几副牌”。同一个牌靴里，同一张实体牌只有一张。
// 牌靴内部只存编号（副数 × 52 + 牌面序号），保存到共享存储时很小；编号只在服务器 / 本地主机里，从不发给客户端。
import { RANKS, SUITS, makeCard, type Card } from './card';

export interface PhysicalCard extends Card {
  /** 实体牌编号，例如 “As-3”（第 3 副牌里的黑桃 A） */
  uid: string;
}

export function cardFromCode(code: number): PhysicalCard {
  const deck = Math.floor(code / 52);
  const k = code % 52;
  const c = makeCard(RANKS[k % 13], SUITS[Math.floor(k / 13)]);
  return { ...c, uid: `${c.id}-${deck}` };
}

/** 第 deck 副牌的 52 个编号 */
export const deckCodes = (deck: number) => Array.from({ length: 52 }, (_, i) => deck * 52 + i);
