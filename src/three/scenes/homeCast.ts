// 首页的“演员表”与演示牌局（纯数据，3D 场景与首页文字共用）
import { makeCard, type Card, type Rank, type Suit } from '../../core/cards/card';
import { randomAnimal, type AnimalConfig, type Species } from '../../core/player/profile';
import { seededRandom } from '../../core/utils/random';
import { FEATURED_SPECIES } from '../../ui/home/homeTimeline';

/** 桌边就座的动物（座位 0 是“你的座位”，留空） */
export const SEAT_SPECIES: Record<number, Species> = { 1: 'cat', 2: 'fox', 3: 'wolf', 4: 'panda', 5: 'rabbit' };
/** 对面的对手（牌局演示与 AI 段落） */
export const RIVAL = 3;
/** 在线段落里朋友们加入的顺序与时间点 */
export const JOIN_AT: Record<number, number> = { 1: 0.22, 5: 0.34, 2: 0.46, 4: 0.58 };
const C = (rank: Rank, suit: Suit) => makeCard(rank, suit);
/** 牌局演示：你 A♠K♠ 对 对手 Q♣Q♦，公共牌 K♦ 7♠ 2♥ A♣ 7♣ → 你以两对 A、K 获胜（由引擎判定，见首页文字） */
export const DEMO_HAND = {
  hero: [C(14, 's'), C(13, 's')] as Card[],
  rival: [C(12, 'c'), C(12, 'd')] as Card[],
  board: [C(13, 'd'), C(7, 's'), C(2, 'h'), C(14, 'c'), C(7, 'c')] as Card[],
};
/** AI 段落：你 9♠9♥，翻牌 9♦ 5♣ J♠ */
export const AI_HAND = {
  hero: [C(9, 's'), C(9, 'h')] as Card[],
  board: [C(9, 'd'), C(5, 'c'), C(11, 's')] as Card[],
};
/** AI 段落：对手的两张暗牌（不会翻开） */
export const AI_HIDDEN = [C(3, 'd'), C(8, 'h')];

let cast: { seats: Record<number, AnimalConfig>; stage: AnimalConfig[] } | null = null;
/** 首页的动物演员（固定外观，首页文字与 3D 场景共用；例如 AI 段落用对面那只狼的真实声音说话） */
export function getHomeCast() {
  if (!cast) {
    const rng = seededRandom(20261122);
    const seats = Object.fromEntries(Object.entries(SEAT_SPECIES).map(([k, sp]) => [k, randomAnimal(rng, [sp])])) as Record<number, AnimalConfig>;
    const r2 = seededRandom(7741);
    cast = { seats, stage: FEATURED_SPECIES.map((sp) => randomAnimal(r2, [sp])) };
  }
  return cast;
}

