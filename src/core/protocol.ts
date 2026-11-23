// 客户端 ⇄ 服务器 消息协议（WebSocket JSON）
import type { PlayerAction } from './table/types';
import type { PlayerProfile } from './player/profile';
import type { TableView } from './game/view';
import type { AIDifficulty, AIPersonality } from './ai/ai';
import type { AccountState, ProgressEvent } from './account/types';
import type { DialogueRef } from './character/dialogue';

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
  /** character：玩家在动物创建器中保存的角色（外观 + 声音 + 口头禅），作为 AI 对手出场 */
  opponents: { personality: AIPersonality; difficulty: AIDifficulty; character?: { name: string; animal: PlayerProfile['animal'] } }[];
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
  /**
   * 角色台词（由服务器决定，所有客户端看到同一句）：客户端据此用本地语音合成播放，
   * 服务器只同步这个小小的事件，从不发送音频文件。
   */
  dialogue?: DialogueRef;
}

export type ClientMessage =
  /** rotate：客户端在平台连接时限到期前主动换一条新连接（服务器不会向旧连接发送“已被替换”通知） */
  /** v：客户端的协议版本（见 PROTOCOL_VERSION） */
  | { t: 'hello'; sessionId?: string; profile: PlayerProfile; rotate?: boolean; v?: number }
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

/**
 * 实时协议版本：消息格式有不兼容的变化时加 1。
 * 网站更新后，一直开着、没有刷新的旧页面仍在运行旧代码：版本不一致时提示玩家刷新，而不是悄悄出错。
 */
export const PROTOCOL_VERSION = 2;

export type ServerMessage =
  /** resumed：是否恢复了之前的会话（服务器重启后旧会话不存在，为 false） */
  | { t: 'welcome'; sessionId: string; playerId: string; resumed?: boolean; rotateInMs?: number; protocol?: number }
  /** 牌局动作的确认：ok=false 时附带原因；duplicate=true 表示重复发送，已忽略 */
  | { t: 'ack'; actionId: string; ok: boolean; message?: string; duplicate?: boolean }
  /** 服务器通知：即将重启；或这个会话已在另一个标签页 / 页面上连接（本连接被替换，不要自动重连） */
  | { t: 'notice'; kind: 'shutdown' | 'replaced'; message: string }
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
