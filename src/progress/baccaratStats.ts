// 百家乐统计（存放在玩家统计 Stats.baccarat 里，与德州、21 点共用同一份存档 / 账号）。全部来自真实的结算结果。
export interface BaccaratStats {
  rounds: number;
  /** 按整局净输赢：赢 / 输 / 打平（例如开和时闲庄退回） */
  wins: number;
  losses: number;
  pushes: number;
  /** 押了这个区的局数，与这个区赢 / 退回的局数 */
  playerBets: number;
  bankerBets: number;
  tieBets: number;
  playerBetWins: number;
  bankerBetWins: number;
  tieBetWins: number;
  playerBetPushes: number;
  bankerBetPushes: number;
  /** 牌桌的结果（自己有下注的局） */
  playerResults: number;
  bankerResults: number;
  tieResults: number;
  naturals: number;
  totalBet: number;
  totalPayout: number;
  largestWin: number;
  largestBet: number;
  winStreak: number;
  bestWinStreak: number;
}

export const EMPTY_BACCARAT: BaccaratStats = {
  rounds: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  playerBets: 0,
  bankerBets: 0,
  tieBets: 0,
  playerBetWins: 0,
  bankerBetWins: 0,
  tieBetWins: 0,
  playerBetPushes: 0,
  bankerBetPushes: 0,
  playerResults: 0,
  bankerResults: 0,
  tieResults: 0,
  naturals: 0,
  totalBet: 0,
  totalPayout: 0,
  largestWin: 0,
  largestBet: 0,
  winStreak: 0,
  bestWinStreak: 0,
};

const KEYS = Object.keys(EMPTY_BACCARAT) as (keyof BaccaratStats)[];

export function normalizeBaccarat(x: unknown): BaccaratStats {
  const src = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const out = { ...EMPTY_BACCARAT };
  for (const k of KEYS) {
    const v = Number(src[k]);
    if (Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
  }
  return out;
}

const BEST: readonly (keyof BaccaratStats)[] = ['largestWin', 'largestBet', 'bestWinStreak'];
const CURRENT: readonly (keyof BaccaratStats)[] = ['winStreak'];

/** 游客存档合并进账号：计数相加、最佳值取较大者；游客数据无法验证，先按上限与一致性收紧 */
export function mergeGuestBaccarat(cur: BaccaratStats, guest: BaccaratStats, limits: { rounds: number; chips: number }): BaccaratStats {
  const g = { ...guest };
  const cap = (v: number, max: number) => Math.max(0, Math.min(max, v));
  g.rounds = cap(g.rounds, limits.rounds);
  g.wins = cap(g.wins, g.rounds);
  g.losses = cap(g.losses, g.rounds - g.wins);
  g.pushes = cap(g.pushes, g.rounds - g.wins - g.losses);
  for (const k of ['playerBets', 'bankerBets', 'tieBets', 'playerResults', 'bankerResults', 'tieResults', 'naturals'] as const) g[k] = cap(g[k], g.rounds);
  g.playerBetWins = cap(g.playerBetWins, g.playerBets);
  g.bankerBetWins = cap(g.bankerBetWins, g.bankerBets);
  g.tieBetWins = cap(g.tieBetWins, g.tieBets);
  g.playerBetPushes = cap(g.playerBetPushes, g.playerBets - g.playerBetWins);
  g.bankerBetPushes = cap(g.bankerBetPushes, g.bankerBets - g.bankerBetWins);
  g.bestWinStreak = cap(g.bestWinStreak, g.wins);
  for (const k of ['largestWin', 'largestBet'] as const) g[k] = cap(g[k], limits.chips);
  for (const k of ['totalBet', 'totalPayout'] as const) g[k] = cap(g[k], limits.chips * 10);
  const out = { ...cur };
  for (const k of KEYS) {
    if (CURRENT.includes(k)) continue;
    out[k] = BEST.includes(k) ? Math.max(cur[k], g[k]) : cur[k] + g[k];
  }
  return out;
}

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');

/**
 * 比例（全部来自真实结果；只用于显示，从不影响发牌）：
 * 押闲胜率 = 押闲赢的局 ÷（押闲的局 − 开和退回的局）；押庄同理；押和命中率 = 押和赢的局 ÷ 押和的局。
 * 胜率 ≠ 盈利：庄赢要抽 5%，和赔 8 倍，所以净输赢另外显示。
 */
export function baccaratRates(s: BaccaratStats) {
  return {
    winRate: pct(s.wins, s.wins + s.losses),
    playerBetWinRate: pct(s.playerBetWins, s.playerBets - s.playerBetPushes),
    bankerBetWinRate: pct(s.bankerBetWins, s.bankerBets - s.bankerBetPushes),
    tieBetWinRate: pct(s.tieBetWins, s.tieBets),
    tieRate: pct(s.tieResults, s.rounds),
    profit: s.totalPayout - s.totalBet,
  };
}
