// 底池 / 边池计算 —— 纯函数，独立可测

export interface Contribution {
  playerId: string;
  /** 本手牌总投入 */
  amount: number;
  /** 是否已弃牌（弃牌玩家的筹码留在池中，但没有资格赢） */
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** 有资格赢得此池的玩家 */
  eligible: string[];
}

export interface PotBreakdown {
  pots: Pot[];
  /** 无人跟注而退回的超额下注 */
  refunds: { playerId: string; amount: number }[];
}

/**
 * 根据每位玩家的总投入计算主池与边池。
 * 算法：按投入层级切片，每一层由所有达到该层的玩家共同出资，
 * 只有达到该层且未弃牌的玩家有资格。仅有一位出资者的顶层视为退款。
 */
export function calculatePots(contribs: Contribution[]): PotBreakdown {
  const levels = [...new Set(contribs.filter((c) => c.amount > 0).map((c) => c.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  const refunds: { playerId: string; amount: number }[] = [];
  let prev = 0;

  for (const level of levels) {
    const slice = level - prev;
    const contributors = contribs.filter((c) => c.amount >= level);
    // 较低投入的玩家在本层贡献了不足 slice 的部分已在前面层级计算
    const amount = slice * contributors.length;
    const eligible = contributors.filter((c) => !c.folded).map((c) => c.playerId);

    if (contributors.length === 1) {
      // 只有一人出资：无人跟注部分退回
      refunds.push({ playerId: contributors[0].playerId, amount });
    } else if (eligible.length === 0) {
      // 罕见：该层所有出资者都已弃牌 —— 并入上一层池
      if (pots.length) pots[pots.length - 1].amount += amount;
      else refunds.push(...contributors.map((c) => ({ playerId: c.playerId, amount: slice })));
    } else {
      const last = pots[pots.length - 1];
      if (last && sameSet(last.eligible, eligible)) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = level;
  }

  return { pots, refunds: mergeRefunds(refunds) };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function mergeRefunds(list: { playerId: string; amount: number }[]) {
  const m = new Map<string, number>();
  for (const r of list) m.set(r.playerId, (m.get(r.playerId) ?? 0) + r.amount);
  return [...m.entries()].map(([playerId, amount]) => ({ playerId, amount }));
}

/**
 * 平分底池：不能整除的零头按座位顺序（庄家左手第一位开始）分配。
 * orderedWinners 必须已经按此顺序排列。
 */
export function splitPot(amount: number, orderedWinners: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = orderedWinners.length;
  const base = Math.floor(amount / n);
  let rem = amount - base * n;
  for (const id of orderedWinners) {
    out.set(id, base + (rem > 0 ? 1 : 0));
    if (rem > 0) rem--;
  }
  return out;
}

export function totalOf(pots: Pot[]): number {
  return pots.reduce((s, p) => s + p.amount, 0);
}
