// 客户端 ⇄ 服务器 消息协议（WebSocket JSON）
import type { PlayerAction } from './table/types';
import type { PlayerProfile } from './player/profile';
import type { TableView } from './game/view';
import type { AIDifficulty, AIPersonality } from './ai/ai';
import type { AccountState, ProgressEvent } from './account/types';

export interface RoomSettings {
  maxPlayers: number; // 2~8
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  turnSeconds: number;
}

/** 在线房间人数上限 */
export const MAX_ROOM_PLAYERS = 6;

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
  /** 单人练习房（与 AI 对战，由服务器运行并结算奖励），其他人无法加入 */
  solo?: boolean;
}

/** 与 AI 对战的设置（登录玩家的对局在服务器上运行，奖励由服务器计算） */
export interface SoloSettings {
  opponents: { personality: AIPersonality; difficulty: AIDifficulty }[];
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
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
  /** actionId：同一个动作重复发送只执行一次；hand：动作针对的手数，过期的动作会被拒绝 */
  | { t: 'action'; action: PlayerAction; actionId?: string; hand?: number }
  | { t: 'chat'; text: string }
  | { t: 'emote'; emoji: string }
  | { t: 'updateProfile'; profile: PlayerProfile }
  | { t: 'backToLobby' }
  | { t: 'startSolo'; settings: SoloSettings }
  | { t: 'restartSolo' }
  | { t: 'pause'; paused: boolean }
  /** 客户端发现事件不连续时请求完整状态 */
  | { t: 'resync' }
  | { t: 'ping'; time: number };

export type ServerMessage =
  /** resumed：是否恢复了之前的会话（服务器重启后旧会话不存在，为 false） */
  | { t: 'welcome'; sessionId: string; playerId: string; resumed?: boolean }
  /** 牌局动作的确认：ok=false 时附带原因；duplicate=true 表示重复发送，已忽略 */
  | { t: 'ack'; actionId: string; ok: boolean; message?: string; duplicate?: boolean }
  /** 服务器通知（例如即将重启） */
  | { t: 'notice'; kind: 'shutdown'; message: string }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'state'; view: TableView }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chatHistory'; messages: ChatMessage[] }
  | { t: 'error'; message: string }
  | { t: 'pong'; time: number; serverTime: number }
  /** 账号数据在服务器上发生变化（其他设备修改、结算完成）；null = 已退出或账号被删除 */
  | { t: 'account'; state: AccountState | null }
  /** 服务器结算奖励后推送：获得的经验、筹码、升级、成就与解锁 */
  | { t: 'progress'; event: ProgressEvent; state: AccountState };

export const EMOTES = ['😂', '😱', '😎', '🔥', '💀', '👏', '❤️', '🤣'];
export const QUICK_CHATS = ['好牌！', '谢谢！', '哈哈哈哈！', '我觉得你在诈牌。', '全押！', '下一局！'];
