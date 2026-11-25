// 奖励规则（纯函数，服务器与游客本地存档共用同一套规则）
// 登录玩家：只有服务器调用这些函数，客户端从不提交经验、等级或筹码
import { HandCategory } from '../core/poker/handEvaluator';
import type { Species } from '../core/player/profile';
import { ACHIEVEMENTS, MAX_LEVEL, type Stats, levelFromXp } from './progression';
import type { BjRoundFacts } from '../core/blackjack/types';

/** 一手牌结束时服务器从牌桌状态中提取的事实（不是客户端上报的数据） */
export interface HandFacts {
  won: boolean;
  /** 本手赢得的筹码（底池） */
  amount: number;
  /** 本手投入的筹码 */
  bet: number;
  /** 亮出的牌型，-1 = 未亮牌 */
  category: number;
  allIn: boolean;
  folded: boolean;
  uncontested: boolean;
  species: Species;
  online: boolean;
}

/** 一整场结束时的事实 */
export interface GameFacts {
  place: number;
  players: number;
  hands: number;
  finalChips: number;
  mode: 'local' | 'online';
}

export const REWARD = {
  xp: {
    handPlayed: 30,
    handWon: 100,
    streakBonusPer: 20,
    streakBonusMax: 100,
    straightOrBetter: 40,
    quadsOrBetter: 150,
    royal: 500,
    gameFinished: 80,
    gameWon: 300,
    dailyFirstGame: 100,
    achievement: 150,
    /** 21 点一局很快，所以每局经验比一手德州少 */
    blackjackRound: 10,
    blackjackWin: 20,
    blackjackNatural: 30,
  },
  chips: {
    gameFinished: 50,
    gameWonBase: 100,
    gameWonPerOpponent: 50,
    dailyFirstGame: 200,
    achievement: 100,
  },
};

/** 本手实际投入 = 下注总额 − 摊牌时退回的未被跟注部分 */
export function effectiveBet(totalBet: number, events: readonly { type: string; playerId?: string; amount?: number }[], playerId: string) {
  const refunded = events.reduce((s, e) => (e.type === 'refund' && e.playerId === playerId ? s + (e.amount ?? 0) : s), 0);
  return Math.max(0, totalBet - refunded);
}

export function cloneStats(s: Stats): Stats {
  return { ...s, speciesWins: { ...s.speciesWins }, blackjack: { ...s.blackjack } };
}

/** 一手牌：更新统计并计算经验（不只靠赢牌：完成每一手都有经验） */
export function applyHand(before: Stats, f: HandFacts): { stats: Stats; xp: number } {
  const s = cloneStats(before);
  let xp = REWARD.xp.handPlayed;
  s.handsPlayed++;
  if (f.online) s.onlineHands++;
  if (f.folded) s.folds++;
  if (f.allIn) s.allIns++;
  s.totalBet += Math.max(0, Math.floor(f.bet));
  if (f.won) {
    const amount = Math.max(0, Math.floor(f.amount));
    s.handsWon++;
    s.currentStreak++;
    s.bestStreak = Math.max(s.bestStreak, s.currentStreak);
    s.biggestPot = Math.max(s.biggestPot, amount);
    s.biggestProfit = Math.max(s.biggestProfit, amount - Math.max(0, Math.floor(f.bet)));
    s.totalWinnings += amount;
    if (f.category >= 0) s.bestHand = Math.max(s.bestHand, f.category);
    if (f.allIn && !f.uncontested) s.allInWins++;
    if (f.uncontested) s.uncontestedWins++;
    s.speciesWins[f.species] = (s.speciesWins[f.species] ?? 0) + 1;
    xp += REWARD.xp.handWon + Math.min(REWARD.xp.streakBonusMax, REWARD.xp.streakBonusPer * (s.currentStreak - 1));
    if (f.category >= HandCategory.RoyalFlush) xp += REWARD.xp.royal;
    else if (f.category >= HandCategory.FourOfAKind) xp += REWARD.xp.quadsOrBetter;
    else if (f.category >= HandCategory.Straight) xp += REWARD.xp.straightOrBetter;
  } else {
    s.currentStreak = 0;
  }
  return { stats: s, xp };
}

/** 一整场：统计 + 经验 + 虚拟筹码奖励 */
export function applyGame(before: Stats, f: GameFacts, dailyFirst: boolean): { stats: Stats; xp: number; chips: number } {
  const s = cloneStats(before);
  s.gamesPlayed++;
  const won = f.place === 1;
  if (won) s.gamesWon++;
  let xp = REWARD.xp.gameFinished;
  let chips = REWARD.chips.gameFinished;
  if (won) {
    xp += REWARD.xp.gameWon;
    chips += REWARD.chips.gameWonBase + REWARD.chips.gameWonPerOpponent * Math.max(0, Math.min(7, f.players - 1));
  }
  if (dailyFirst) {
    xp += REWARD.xp.dailyFirstGame;
    chips += REWARD.chips.dailyFirstGame;
  }
  return { stats: s, xp, chips };
}

/** 一局 21 点：更新统计并计算经验。按“这一局净赢 / 净输 / 打平”计胜负；离桌放弃算输 */
export function applyBlackjackRound(before: Stats, f: BjRoundFacts): { stats: Stats; xp: number } {
  const s = cloneStats(before);
  const b = s.blackjack;
  let xp = REWARD.xp.blackjackRound;
  b.rounds++;
  b.totalBet += f.bet;
  b.totalPayout += f.payout;
  b.largestBet = Math.max(b.largestBet, f.bet);
  b.largestWin = Math.max(b.largestWin, f.profit);
  if (f.hands.some((h) => h.fromSplit)) b.splits += f.hands.length - 1;
  for (const h of f.hands) {
    if (h.doubled) b.doubleDowns++;
    if (h.result === 'bust') b.busts++;
    if (h.result === 'blackjack') {
      b.blackjacks++;
      xp += REWARD.xp.blackjackNatural;
    }
    if (h.result === 'win') {
      if (h.doubled) b.doubleWins++;
      if (h.value === 21 && h.cards > 2) b.wins21++;
    }
  }
  // 与庄家同时黑杰克是平局，但这确实是一次黑杰克
  if (f.hands.length === 1 && f.hands[0].result === 'push' && f.hands[0].value === 21 && f.hands[0].cards === 2 && !f.hands[0].fromSplit) b.blackjacks++;
  if (f.profit > 0) {
    b.wins++;
    if (b.lossStreak >= 3) b.comebacks++;
    b.lossStreak = 0;
    b.winStreak++;
    b.bestWinStreak = Math.max(b.bestWinStreak, b.winStreak);
    xp += REWARD.xp.blackjackWin;
  } else if (f.profit < 0) {
    b.losses++;
    b.lossStreak++;
    b.winStreak = 0;
  } else b.pushes++;
  return { stats: s, xp };
}

/** 根据统计找出新达成的成就 */
export function newAchievements(stats: Stats, have: Record<string, number>): string[] {
  return ACHIEVEMENTS.filter((a) => !have[a.id] && a.check(stats)).map((a) => a.id);
}

export function clampLevel(xp: number) {
  return Math.min(MAX_LEVEL, levelFromXp(xp));
}
