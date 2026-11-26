// 21 点的数据结构：引擎状态、事件、发给客户端的视图、客户端命令
import type { AIPersonality } from '../ai/ai';
import type { PlayerProfile } from '../player/profile';
import type { BlackjackRules, HandResult } from './rules';
import type { BjCard } from './shoe';

export type BlackjackPhase = 'idle' | 'betting' | 'dealing' | 'player-turn' | 'dealer-turn' | 'resolution' | 'payout' | 'round-end';

export const BJ_PHASE_NAME: Record<BlackjackPhase, string> = {
  idle: '准备中',
  betting: '下注',
  dealing: '发牌',
  'player-turn': '玩家行动',
  'dealer-turn': '庄家行动',
  resolution: '结算',
  payout: '派彩',
  'round-end': '本局结束',
};

/** 阶段只能按这张表前进；非法跳转说明程序有错误 */
export const BJ_TRANSITIONS: Record<BlackjackPhase, readonly BlackjackPhase[]> = {
  idle: ['betting'],
  betting: ['dealing'],
  dealing: ['player-turn', 'dealer-turn'],
  'player-turn': ['dealer-turn'],
  'dealer-turn': ['resolution'],
  resolution: ['payout'],
  payout: ['round-end'],
  'round-end': ['betting'],
};

export type BjAction = 'hit' | 'stand' | 'double' | 'split';
export const BJ_ACTIONS: readonly BjAction[] = ['hit', 'stand', 'double', 'split'];
export const BJ_ACTION_NAME: Record<BjAction, string> = { hit: '要牌', stand: '停牌', double: '加倍', split: '分牌' };

export interface BjHand {
  id: string;
  cards: BjCard[];
  bet: number;
  /** 不能再行动（停牌、爆牌、21 点、黑杰克、加倍后、分 A 后） */
  done: boolean;
  doubled: boolean;
  fromSplit: boolean;
  forfeited: boolean;
  result: HandResult | null;
  /** 返还总额（含本金），结算后才有 */
  payout: number;
}

export interface BjPlayer {
  id: string;
  name: string;
  seat: number;
  /** 手里的筹码（不含桌上的下注） */
  balance: number;
  /** 这一局确认的主注（0 = 还没下注） */
  bet: number;
  skipped: boolean;
  hands: BjHand[];
  activeHand: number;
  left: boolean;
}

export interface BjHandOutcome {
  handId: string;
  result: HandResult;
  bet: number;
  payout: number;
}

export type BjEventBody =
  | { type: 'shuffle' }
  | { type: 'roundStart'; round: number; roundId: string }
  | { type: 'bet'; playerId: string; amount: number }
  | { type: 'skip'; playerId: string }
  /** card = null：庄家的暗牌（事件里永远不带真实点数，翻开时由 dealerReveal 带出） */
  | { type: 'card'; to: string; handId: string | null; index: number; card: BjCard | null; kind: 'deal' | 'hit' | 'double' | 'split' }
  | { type: 'blackjack'; playerId: string; handId: string }
  | { type: 'turn'; playerId: string; handId: string }
  | { type: 'hit'; playerId: string; handId: string }
  | { type: 'stand'; playerId: string; handId: string; auto: boolean }
  | { type: 'double'; playerId: string; handId: string; added: number }
  | { type: 'split'; playerId: string; handId: string; newHandId: string; added: number }
  | { type: 'bust'; playerId: string; handId: string }
  | { type: 'dealerReveal'; card: BjCard }
  | { type: 'dealerBlackjack' }
  | { type: 'dealerStand'; value: number }
  | { type: 'dealerBust'; value: number }
  | { type: 'resolved'; roundId: string; outcomes: { playerId: string; hands: BjHandOutcome[] }[] }
  | { type: 'payout'; playerId: string; amount: number; profit: number }
  | { type: 'left'; playerId: string }
  | { type: 'roundEnd'; roundId: string };

export type BjEvent = BjEventBody & { seq: number };

export interface BjLegal {
  hit: boolean;
  stand: boolean;
  double: boolean;
  split: boolean;
  /** 加倍 / 分牌需要再放上的筹码 */
  cost: number;
}

/** 客户端命令。round / token 用来拒绝过期与重复的操作（见 BlackjackController.handle） */
export type BjCommand =
  | { type: 'bet'; amount: number }
  | { type: 'skip' }
  | { type: BjAction }
  | { type: 'next' }
  | { type: 'rebuy' };

/** 一名玩家一局的结算事实（奖励 / 统计用；只由引擎产生） */
export interface BjRoundFacts {
  roundId: string;
  /** 全部下注（含加倍与分牌） */
  bet: number;
  payout: number;
  profit: number;
  hands: { result: HandResult; value: number; cards: number; doubled: boolean; fromSplit: boolean }[];
  /** 庄家爆牌（统计用；旧数据没有） */
  dealerBust?: boolean;
}

export interface BjHandView {
  id: string;
  cards: BjCard[];
  value: number;
  soft: boolean;
  blackjack: boolean;
  bust: boolean;
  bet: number;
  done: boolean;
  doubled: boolean;
  fromSplit: boolean;
  result: HandResult | null;
  payout: number;
}

export interface BjSeatView {
  id: string;
  name: string;
  seat: number;
  isAI: boolean;
  aiPersonality?: AIPersonality;
  connected: boolean;
  left: boolean;
  profile: PlayerProfile;
  balance: number;
  bet: number;
  skipped: boolean;
  hands: BjHandView[];
  activeHand: number;
}

export interface BjDealerView {
  profile: PlayerProfile;
  /** 性格一句话（只影响台词与动作，绝不影响牌） */
  trait: string;
  /** 暗牌翻开前第二张为 null */
  cards: (BjCard | null)[];
  revealed: boolean;
  /** 只按看得见的牌计算 */
  value: number;
  soft: boolean;
  blackjack: boolean;
  bust: boolean;
}

/** 筹码来源：profile = 玩家的持久金币；table = 房间发的桌上筹码（不影响持久金币） */
export type BjEconomy = 'profile' | 'table';

export interface BlackjackView {
  kind: 'blackjack';
  viewerId: string;
  round: number;
  roundId: string;
  phase: BlackjackPhase;
  rules: BlackjackRules;
  economy: BjEconomy;
  /** 看这份视图的玩家还能补充几次筹码（null = 不限 / 不适用） */
  refillsLeft: number | null;
  solo: boolean;
  shoe: { remaining: number; size: number };
  dealer: BjDealerView;
  players: BjSeatView[];
  currentPlayerId: string | null;
  currentHandId: string | null;
  /** 轮到自己时的合法动作 */
  legal: BjLegal | null;
  /** 行动令牌：每执行一次动作就变化，带着旧令牌的重复操作会被拒绝 */
  token: number;
  /** 行动 / 下注截止时间（没有计时时为 null） */
  turnDeadline: number | null;
  turnTotalMs: number;
  nextRoundAt: number | null;
  events: BjEvent[];
  serverTime: number;
  /** 在线：events 只包含上次之后的新事件 */
  eventsDelta?: boolean;
}

export const DEALER_ID = 'dealer';
