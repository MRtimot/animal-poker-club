import type { Card } from '../cards/card';
import type { GameEvent, HandSummary, LegalActions, Phase, EnginePlayer } from '../table/types';
import type { PlayerProfile } from '../player/profile';
import type { AIDifficulty, AIPersonality } from '../ai/ai';

/** 每位客户端看到的座位信息（其他玩家的底牌被隐藏为 null） */
export interface SeatView {
  id: string;
  name: string;
  seat: number;
  chips: number;
  bet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  sittingOut: boolean;
  busted: boolean;
  isAI: boolean;
  aiPersonality?: AIPersonality;
  connected: boolean;
  profile: PlayerProfile;
  lastAction: EnginePlayer['lastAction'];
  hole: (Card | null)[];
  shown?: { handName: string; bestCards: Card[]; category: number };
}

export interface GameOverInfo {
  rankings: { playerId: string; name: string; chips: number; place: number }[];
  winnerId: string;
}

export interface TableView {
  viewerId: string;
  handNumber: number;
  phase: Phase;
  board: Card[];
  /** 已收入底池的筹码（不含当前街的下注） */
  potCollected: number;
  /** 当前所有下注（含本街） */
  potTotal: number;
  pots: number[];
  currentBet: number;
  currentPlayerId: string | null;
  dealerId: string | null;
  sbId: string | null;
  bbId: string | null;
  smallBlind: number;
  bigBlind: number;
  players: SeatView[];
  legal: LegalActions | null;
  /** 当前行动截止时间（服务器时间戳 ms） */
  turnDeadline: number | null;
  turnTotalMs: number;
  events: GameEvent[];
  summary: HandSummary | null;
  gameOver: GameOverInfo | null;
  nextHandAt: number | null;
  serverTime: number;
  paused: boolean;
  /** 在线：events 只包含上次发送之后的新事件，客户端追加到本手已有事件后面（节省流量） */
  eventsDelta?: boolean;
}

export interface SeatConfig {
  id: string;
  profile: PlayerProfile;
  chips: number;
  isAI: boolean;
  aiPersonality?: AIPersonality;
  aiDifficulty?: AIDifficulty;
}
