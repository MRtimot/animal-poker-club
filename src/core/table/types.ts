import type { Card } from '../cards/card';

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface PlayerAction {
  type: ActionType;
  /** 加注时：本轮下注加到的总额（raise to） */
  amount?: number;
}

export type Phase = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type Street = 'flop' | 'turn' | 'river';

export const PHASE_NAME: Record<Phase, string> = {
  idle: '等待开始',
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  complete: '本局结束',
};

export const ACTION_NAME: Record<ActionType, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  raise: '加注',
  allin: '全押',
};

export interface EnginePlayer {
  id: string;
  name: string;
  seat: number;
  chips: number;
  hole: Card[];
  /** 本轮（当前街）已下注 */
  bet: number;
  /** 本手牌累计投入 */
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  /** 自上次完整加注以来是否已行动 */
  acted: boolean;
  /** 是否参与本手牌 */
  inHand: boolean;
  /** 暂离 / 已离开：轮到时自动弃牌，且不再参与新的一手 */
  sittingOut: boolean;
  lastAction: { type: ActionType | 'sb' | 'bb'; amount: number } | null;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  canAllIn: boolean;
  allInAmount: number;
  toCall: number;
}

export interface Award {
  playerId: string;
  amount: number;
  potIndex: number;
  handName?: string;
}

export interface ShownHand {
  playerId: string;
  cards: Card[];
  handName: string;
  bestCards: Card[];
  category: number;
}

export type GameEventBody =
  | { type: 'handStart'; handNumber: number; dealerId: string; sbId: string; bbId: string }
  | { type: 'blind'; playerId: string; amount: number; kind: 'sb' | 'bb' }
  | { type: 'dealHole'; order: string[] }
  | { type: 'turn'; playerId: string }
  | { type: 'action'; playerId: string; action: ActionType; added: number; betTo: number; allIn: boolean }
  | { type: 'collect'; amounts: { playerId: string; amount: number }[] }
  | { type: 'board'; street: Street; cards: Card[] }
  | { type: 'showdown'; hands: ShownHand[] }
  | { type: 'win'; awards: Award[]; uncontested: boolean; pots: number[] }
  | { type: 'refund'; playerId: string; amount: number }
  | { type: 'handEnd' };

export type GameEvent = GameEventBody & { seq: number; t: number };

export interface HandSummary {
  handNumber: number;
  winners: { playerId: string; amount: number; handName?: string }[];
  shown: ShownHand[];
  uncontested: boolean;
  board: Card[];
}
