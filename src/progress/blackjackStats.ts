// 21 点统计（存放在玩家统计 Stats.blackjack 里，与德州扑克共用同一份存档 / 账号）
export interface BlackjackStats {
  rounds: number;
  wins: number;
  losses: number;
  pushes: number;
  blackjacks: number;
  busts: number;
  doubleDowns: number;
  splits: number;
  /** 加倍后赢下的手数 */
  doubleWins: number;
  /** 用普通 21 点（不是黑杰克）赢下的手数 */
  wins21: number;
  /** 连输 3 局以上之后赢回来的次数 */
  comebacks: number;
  largestWin: number;
  largestBet: number;
  totalBet: number;
  totalPayout: number;
  winStreak: number;
  bestWinStreak: number;
  lossStreak: number;
}

export const EMPTY_BLACKJACK: BlackjackStats = {
  rounds: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  blackjacks: 0,
  busts: 0,
  doubleDowns: 0,
  splits: 0,
  doubleWins: 0,
  wins21: 0,
  comebacks: 0,
  largestWin: 0,
  largestBet: 0,
  totalBet: 0,
  totalPayout: 0,
  winStreak: 0,
  bestWinStreak: 0,
  lossStreak: 0,
};

const KEYS = Object.keys(EMPTY_BLACKJACK) as (keyof BlackjackStats)[];

/** 旧存档没有这些字段、或数据损坏：补 0 */
export function normalizeBlackjack(x: unknown): BlackjackStats {
  const src = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const out = { ...EMPTY_BLACKJACK };
  for (const k of KEYS) {
    const v = Number(src[k]);
    if (Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
  }
  return out;
}

const SUM: readonly (keyof BlackjackStats)[] = ['rounds', 'wins', 'losses', 'pushes', 'blackjacks', 'busts', 'doubleDowns', 'splits', 'doubleWins', 'wins21', 'comebacks', 'totalBet', 'totalPayout'];
const BEST: readonly (keyof BlackjackStats)[] = ['largestWin', 'largestBet', 'bestWinStreak'];

/** 游客存档合并进账号：计数相加、最佳值取较大者。游客数据无法验证，所以先按上限与一致性收紧 */
export function mergeGuestBlackjack(cur: BlackjackStats, guest: BlackjackStats, limits: { rounds: number; chips: number }): BlackjackStats {
  const g = { ...guest };
  const cap = (v: number, max: number) => Math.max(0, Math.min(max, v));
  g.rounds = cap(g.rounds, limits.rounds);
  g.wins = cap(g.wins, g.rounds);
  g.losses = cap(g.losses, g.rounds - g.wins);
  g.pushes = cap(g.pushes, g.rounds - g.wins - g.losses);
  // 一局最多拆成 4 手
  for (const k of ['blackjacks', 'busts', 'doubleDowns', 'splits', 'doubleWins', 'wins21'] as const) g[k] = cap(g[k], g.rounds * 4);
  g.comebacks = cap(g.comebacks, g.wins);
  g.bestWinStreak = cap(g.bestWinStreak, g.wins);
  for (const k of ['largestWin', 'largestBet'] as const) g[k] = cap(g[k], limits.chips);
  for (const k of ['totalBet', 'totalPayout'] as const) g[k] = cap(g[k], limits.chips * 10);
  const out = { ...cur };
  for (const k of SUM) out[k] = cur[k] + g[k];
  for (const k of BEST) out[k] = Math.max(cur[k], g[k]);
  return out;
}

/** 胜率（按局：净赢 / 全部局数） */
export function blackjackWinRate(s: BlackjackStats): string {
  return s.rounds ? `${((s.wins / s.rounds) * 100).toFixed(1)}%` : '—';
}
