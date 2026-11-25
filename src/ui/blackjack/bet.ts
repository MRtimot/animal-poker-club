// 下注草稿（纯函数）：筹码加减、上限、步长。真正的校验在引擎 / 服务器
import { BET_CHIPS, betError, type BlackjackRules } from '../../core/blackjack/rules';

/** 这张桌子上有意义的筹码：不超过最高下注，最多 5 枚 */
export function tableChips(r: Pick<BlackjackRules, 'minBet' | 'maxBet'>): number[] {
  const list = BET_CHIPS.filter((c) => c <= r.maxBet && c * 4 >= r.minBet);
  return list.slice(0, 5);
}

/** 加减一步：不超过最低下注的最大面额 */
export function betStep(r: Pick<BlackjackRules, 'minBet'>): number {
  return [...BET_CHIPS].reverse().find((c) => c <= r.minBet) ?? BET_CHIPS[0];
}

export function addChip(draft: number, chip: number, balance: number, r: Pick<BlackjackRules, 'maxBet'>): number {
  return Math.max(0, Math.min(draft + chip, balance, r.maxBet));
}

export function nudgeBet(draft: number, dir: 1 | -1, balance: number, r: Pick<BlackjackRules, 'minBet' | 'maxBet'>): number {
  const step = betStep(r);
  if (dir > 0) return draft < r.minBet ? Math.min(r.minBet, balance) : addChip(draft, step, balance, r);
  const next = draft - step;
  return next < r.minBet ? 0 : next;
}

/** 上一局的下注现在还能不能照样下（余额不够时取能下的最大值） */
export function rebetAmount(last: number, balance: number, r: Pick<BlackjackRules, 'minBet' | 'maxBet'>): number {
  const v = Math.min(last, balance, r.maxBet);
  return betError(v, balance, r) ? 0 : v;
}
