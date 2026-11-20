// 等级、经验值与成就（纯本地，不涉及任何真实货币）
import { HandCategory } from '../core/poker/handEvaluator';
import { SPECIES, Species } from '../core/player/profile';

export const XP_RULES = {
  handPlayed: 30,
  handWon: 100,
  streakBonusPer: 20,
  streakBonusMax: 100,
  gameWon: 300,
};

/** 到达等级 L 需要的累计经验：100·L·(L-1) */
export function xpForLevel(level: number): number {
  return 100 * level * (level - 1);
}

export function levelFromXp(xp: number): number {
  let l = 1;
  while (xp >= xpForLevel(l + 1)) l++;
  return l;
}

export function levelProgress(xp: number) {
  const level = levelFromXp(xp);
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, into: xp - cur, need: next - cur, ratio: (xp - cur) / (next - cur) };
}

export interface Stats {
  handsPlayed: number;
  handsWon: number;
  gamesPlayed: number;
  gamesWon: number;
  biggestPot: number;
  bestHand: number; // HandCategory，-1 = 无
  currentStreak: number;
  bestStreak: number;
  allInWins: number;
  uncontestedWins: number;
  onlineHands: number;
  speciesWins: Partial<Record<Species, number>>;
}

export const EMPTY_STATS: Stats = {
  handsPlayed: 0,
  handsWon: 0,
  gamesPlayed: 0,
  gamesWon: 0,
  biggestPot: 0,
  bestHand: -1,
  currentStreak: 0,
  bestStreak: 0,
  allInWins: 0,
  uncontestedWins: 0,
  onlineHands: 0,
  speciesWins: {},
};

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  check: (s: Stats) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_win', name: '第一场胜利', desc: '赢下你的第一手牌', icon: '🏆', check: (s) => s.handsWon >= 1 },
  { id: 'streak5', name: '连胜 5 局', desc: '连续赢下 5 手牌（解锁：狼）', icon: '🔥', check: (s) => s.bestStreak >= 5 },
  { id: 'quads', name: '四条', desc: '用四条赢下一手牌', icon: '🎲', check: (s) => s.bestHand >= HandCategory.FourOfAKind },
  { id: 'royal', name: '皇家同花顺', desc: '用皇家同花顺赢下一手牌', icon: '👑', check: (s) => s.bestHand >= HandCategory.RoyalFlush },
  { id: 'full_house', name: '葫芦玩家', desc: '用葫芦或更大的牌型赢牌', icon: '🏠', check: (s) => s.bestHand >= HandCategory.FullHouse },
  { id: 'allin_win', name: '全押获胜', desc: '全押后赢下底池（解锁：青蛙）', icon: '💥', check: (s) => s.allInWins >= 1 },
  { id: 'hands100', name: '100 局完成', desc: '累计完成 100 手牌', icon: '💯', check: (s) => s.handsPlayed >= 100 },
  { id: 'fox_master', name: '狐狸大师', desc: '使用狐狸赢下 30 手牌', icon: '🦊', check: (s) => (s.speciesWins.fox ?? 0) >= 30 },
  { id: 'champion', name: '扑克之王', desc: '赢得一整场比赛的冠军', icon: '🥇', check: (s) => s.gamesWon >= 1 },
  { id: 'bluffer', name: '诈唬大师', desc: '让所有对手弃牌赢下 10 次底池', icon: '🎭', check: (s) => s.uncontestedWins >= 10 },
  { id: 'big_pot', name: '大赢家', desc: '单手赢得 5,000 以上筹码', icon: '💰', check: (s) => s.biggestPot >= 5000 },
  { id: 'online', name: '在线初体验', desc: '完成一手在线对局', icon: '🌏', check: (s) => s.onlineHands >= 1 },
];

export function isSpeciesUnlocked(id: Species, level: number, achievements: Record<string, number>): boolean {
  const info = SPECIES.find((s) => s.id === id)!;
  if (info.unlock.level && level < info.unlock.level) return false;
  if (info.unlock.achievement && !achievements[info.unlock.achievement]) return false;
  return true;
}

export function unlockText(id: Species): string {
  const info = SPECIES.find((s) => s.id === id)!;
  if (info.unlock.level) return `达到 ${info.unlock.level} 级解锁`;
  if (info.unlock.achievement) {
    const a = ACHIEVEMENTS.find((x) => x.id === info.unlock.achievement);
    return `完成成就「${a?.name ?? ''}」解锁`;
  }
  return '默认解锁';
}

export interface RecentGame {
  time: number;
  mode: 'local' | 'online';
  place: number;
  players: number;
  hands: number;
  chips: number;
}
