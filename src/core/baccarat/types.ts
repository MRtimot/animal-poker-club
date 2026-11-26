// 百家乐的数据结构：引擎状态、事件、发给客户端的视图、客户端命令
import type { AIPersonality } from '../ai/ai';
import type { PlayerProfile } from '../player/profile';
import type { BacBets, BacSpot, BacWinner, BaccaratRules } from './rules';
import type { BacCard } from './shoe';

/**
 * 一局的阶段：下注 → 停止下注（牌已经按规则发好，但一张都还没公开）→ 逐张翻牌 → 结果 → 派彩 → 本局结束。
 * 补牌在“停止下注”的瞬间就由规则决定了；翻牌只是按顺序把已经确定的牌公开给所有人。
 */
export type BaccaratPhase = 'idle' | 'betting' | 'closed' | 'dealing' | 'result' | 'payout' | 'round-end';

export const BAC_PHASE_NAME: Record<BaccaratPhase, string> = {
  idle: '准备中',
  betting: '下注',
  closed: '停止下注',
  dealing: '开牌',
  result: '结果',
  payout: '派彩',
  'round-end': '本局结束',
};

/** 阶段只能按这张表前进；非法跳转说明程序有错误 */
export const BAC_TRANSITIONS: Record<BaccaratPhase, readonly BaccaratPhase[]> = {
  idle: ['betting'],
  betting: ['closed'],
  closed: ['dealing'],
  dealing: ['result'],
  result: ['payout'],
  payout: ['round-end'],
  'round-end': ['betting'],
};

export type BacSide = 'player' | 'banker';

export interface BacPlayer {
  id: string;
  name: string;
  seat: number;
  /** 手里的筹码（不含桌上的下注） */
  balance: number;
  bets: BacBets;
  /** 这一局已经确认下注（每局只能确认一次） */
  placed: boolean;
  skipped: boolean;
  left: boolean;
  /** 每个下注区的返还（含本金），结算后才有 */
  returns: BacBets;
}

export interface BacHistoryEntry {
  round: number;
  winner: BacWinner;
  player: number;
  banker: number;
  natural: boolean;
}

export type BacEventBody =
  | { type: 'shuffle'; shoeId: string }
  | { type: 'roundStart'; round: number; roundId: string }
  | { type: 'bet'; playerId: string; bets: BacBets }
  | { type: 'skip'; playerId: string }
  | { type: 'closed' }
  /** 一张牌被公开（之前它不在任何视图或事件里） */
  | { type: 'card'; side: BacSide; index: number; card: BacCard; third: boolean }
  /** 例牌：最初两张 8 或 9，双方都不再补牌 */
  | { type: 'natural'; side: BacSide | 'both'; score: number }
  /** 补牌规则的决定（只在对应的牌都公开之后才发出） */
  | { type: 'rule'; side: BacSide; action: 'draw' | 'stand'; total: number }
  | { type: 'result'; roundId: string; winner: BacWinner; player: number; banker: number; outcomes: { playerId: string; bets: BacBets; returns: BacBets }[] }
  | { type: 'payout'; playerId: string; amount: number; profit: number }
  | { type: 'left'; playerId: string }
  | { type: 'roundEnd'; roundId: string };

export type BacEvent = BacEventBody & { seq: number };

/** 客户端命令。round 用来拒绝过期（上一局）的命令 */
export type BacCommand = { type: 'bet'; bets: Partial<BacBets> } | { type: 'skip' } | { type: 'next' } | { type: 'rebuy' };

/** 一名玩家一局的结算事实（奖励 / 统计用；只由引擎产生） */
export interface BacRoundFacts {
  roundId: string;
  bets: BacBets;
  returns: BacBets;
  bet: number;
  payout: number;
  profit: number;
  winner: BacWinner;
  playerScore: number;
  bankerScore: number;
  natural: boolean;
}

export interface BacHandView {
  /** 已经公开的牌 */
  cards: BacCard[];
  /** 只按公开的牌计算 */
  score: number;
  natural: boolean;
}

export interface BacSeatView {
  id: string;
  name: string;
  seat: number;
  isAI: boolean;
  aiPersonality?: AIPersonality;
  connected: boolean;
  left: boolean;
  profile: PlayerProfile;
  balance: number;
  bets: BacBets;
  placed: boolean;
  skipped: boolean;
  /** 结算后才有 */
  returns: BacBets | null;
}

export type BacEconomy = 'profile' | 'table';

export interface BaccaratView {
  kind: 'baccarat';
  viewerId: string;
  round: number;
  roundId: string;
  phase: BaccaratPhase;
  rules: BaccaratRules;
  economy: BacEconomy;
  /** 看这份视图的玩家还能补充几次筹码（null = 不限 / 不适用） */
  refillsLeft: number | null;
  solo: boolean;
  shoe: { remaining: number; size: number; decks: number; shoeId: string };
  dealer: { profile: PlayerProfile; trait: string };
  hands: Record<BacSide, BacHandView>;
  /** 全部牌公开并结算后才有 */
  result: { winner: BacWinner; player: number; banker: number } | null;
  players: BacSeatView[];
  /** 这张牌桌最近的真实结果（只是记录：每一局都是独立的，过去的结果不影响下一局） */
  history: BacHistoryEntry[];
  /** 下注截止时间（没有计时时为 null） */
  turnDeadline: number | null;
  turnTotalMs: number;
  nextRoundAt: number | null;
  events: BacEvent[];
  serverTime: number;
  eventsDelta?: boolean;
}

export const BAC_DEALER_ID = 'dealer';

export type { BacSpot, BacWinner };
