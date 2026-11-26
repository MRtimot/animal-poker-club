// 百家乐下注草稿（纯函数）：选区 + 加筹码、上限、重复上一局。真正的校验在引擎 / 服务器
import { NO_BETS, bacBetError, betTotal, type BacBets, type BacSpot, type BaccaratRules } from '../../core/baccarat/rules';

const CHIPS = [5, 25, 100, 500, 1000, 5000] as const;

/** 这张桌上有意义的筹码：不超过每区上限，最多 5 枚 */
export function bacTableChips(r: Pick<BaccaratRules, 'minBet' | 'maxBet'>): number[] {
  return CHIPS.filter((c) => c <= r.maxBet && c * 4 >= r.minBet).slice(0, 5);
}

/** 往一个区加筹码：不超过这一区的上限，三区合计不超过余额 */
export function addToSpot(d: BacBets, spot: BacSpot, chip: number, balance: number, r: Pick<BaccaratRules, 'maxBet'>): BacBets {
  const room = balance - betTotal(d);
  const add = Math.max(0, Math.min(chip, room, r.maxBet - d[spot]));
  return add > 0 ? { ...d, [spot]: d[spot] + add } : d;
}

/** 上一局的下注现在还能不能照样下（不行就整份放弃，避免悄悄改成别的组合） */
export function rebetBets(last: BacBets | null, balance: number, r: Pick<BaccaratRules, 'minBet' | 'maxBet'>): BacBets {
  if (!last || betTotal(last) <= 0) return { ...NO_BETS };
  return bacBetError(last, balance, r) ? { ...NO_BETS } : { ...last };
}

/** 草稿里“已经押了但不到最低”的区，用来提示 */
export function underMin(d: BacBets, r: Pick<BaccaratRules, 'minBet'>): BacSpot[] {
  return (['player', 'banker', 'tie'] as BacSpot[]).filter((s) => d[s] > 0 && d[s] < r.minBet);
}
