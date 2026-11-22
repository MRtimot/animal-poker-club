// 首页演示牌局的文字数据（底池金额、牌型描述）
import { HandCategory, type HandResult } from '../../core/poker/handEvaluator';
import { rankLabel } from '../../core/cards/card';

/** 底池金额（随进度变化）：盲注 300 → 加注 / 跟注后 1,500 → 全押 / 跟注后 6,300 */
export const POT_FINAL = 6300;
export function demoPot(p: number) {
  const s = (a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
  return Math.round((300 + 1200 * s(0.54, 0.6) + 4800 * s(0.8, 0.85)) / 50) * 50;
}

/** 牌型 + 关键点数，例如“两对（A 与 K）” */
export function handText(h: HandResult) {
  // ranks 是比较用的点数序列（例如两对 A、K：A A K K 7），先去重
  const r = [...new Set(h.ranks)];
  if (h.category === HandCategory.TwoPair) return `${h.name}（${rankLabel(r[0])} 与 ${rankLabel(r[1])}）`;
  if (h.category === HandCategory.OnePair || h.category === HandCategory.ThreeOfAKind) return `${h.name}（${rankLabel(r[0])}）`;
  return h.name;
}

