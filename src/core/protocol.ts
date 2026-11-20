// 客户端 ⇄ 服务器 消息协议（WebSocket JSON）
import type { PlayerAction } from './table/types';
import type { PlayerProfile } from './player/profile';
import type { TableView } from './game/view';
import type { AIDifficulty, AIPersonality } from './ai/ai';

export interface RoomSettings {
  maxPlayers: number; // 2~8
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  turnSeconds: number;
}

export const CHIP_OPTIONS = [1000, 5000, 10000, 50000];
export const BLIND_OPTIONS: [number, number][] = [
  [10, 20],
  [25, 50],
  [50, 100],
  [100, 200],
];

export interface LobbyMember {
  id: string;
  profile: PlayerProfile;
  isAI: boolean;
  aiPersonality?: AIPersonality;
  aiDifficulty?: AIDifficulty;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  chips: number;
}

export interface RoomInfo {
  code: string;
  hostId: string;
  settings: RoomSettings;
  members: LobbyMember[];
  status: 'lobby' | 'playing' | 'finished';
}

export interface ChatMessage {
  id: string;
  from: string; // 玩家 id，'system' = 系统消息
  name: string;
  text: string;
  kind: 'chat' | 'emote' | 'system';
  time: number;
}

export type ClientMessage =
  | { t: 'hello'; sessionId?: string; profile: PlayerProfile }
  | { t: 'createRoom'; settings: RoomSettings }
  | { t: 'joinRoom'; code: string }
  | { t: 'leaveRoom' }
  | { t: 'ready'; ready: boolean }
  | { t: 'addAI'; personality: AIPersonality; difficulty: AIDifficulty }
  | { t: 'removeMember'; id: string }
  | { t: 'startGame' }
  | { t: 'action'; action: PlayerAction }
  | { t: 'chat'; text: string }
  | { t: 'emote'; emoji: string }
  | { t: 'updateProfile'; profile: PlayerProfile }
  | { t: 'backToLobby' }
  | { t: 'ping'; time: number };

export type ServerMessage =
  | { t: 'welcome'; sessionId: string; playerId: string }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'state'; view: TableView }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chatHistory'; messages: ChatMessage[] }
  | { t: 'error'; message: string }
  | { t: 'pong'; time: number; serverTime: number };

export const EMOTES = ['😂', '😱', '😎', '🔥', '💀', '👏', '❤️', '🤣'];
export const QUICK_CHATS = ['好牌！', '谢谢！', '哈哈哈哈！', '我觉得你在诈牌。', '全押！', '下一局！'];
