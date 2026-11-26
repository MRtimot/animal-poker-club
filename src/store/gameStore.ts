import { create } from 'zustand';
import type { TableView } from '../core/game/view';
import type { ChatMessage, RoomInfo } from '../core/protocol';
import type { BlackjackView } from '../core/blackjack/types';
import type { BaccaratView } from '../core/baccarat/types';
import { DEFAULT_GAME_MODE, type GameMode } from '../core/gameMode';

export type Screen = 'home' | 'login' | 'onboarding' | 'profile' | 'creator' | 'quick' | 'online' | 'room' | 'game' | 'collection' | 'settings';
export type CameraMode = 'overview' | 'player' | 'free';
export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success' | 'unlock';
}

export interface GameState {
  screen: Screen;
  mode: 'local' | 'online' | null;
  /** 德州扑克牌桌（与 bj 同一时间只会有一个） */
  view: TableView | null;
  /** 21 点牌桌 */
  bj: BlackjackView | null;
  /** 百家乐牌桌（与 view / bj 同一时间只会有一个） */
  bac: BaccaratView | null;
  /** 扑克大厅里选中的游戏模式 */
  hubMode: GameMode;
  room: RoomInfo | null;
  chat: ChatMessage[];
  conn: ConnStatus;
  playerId: string | null;
  cameraMode: CameraMode;
  toasts: Toast[];
  modal: null | 'rules' | 'tutorial' | 'leave';
  clockOffset: number; // serverTime - localTime
  onlineTab: 'create' | 'join';
  /** 已发送、等待服务器确认的牌局动作 */
  pendingAction: { id: string; type: string; at: number } | null;
  /** 收到“服务器即将重启”通知（之后的断线不是普通网络问题，房间会失效） */
  serverRestarting: boolean;
  /** 与服务器的往返延迟（毫秒），用于调试面板 */
  latency: number | null;
  /** 这个标签页最近所在的在线房间代码（刷新后用来回到座位；离开 / 房间失效时清空） */
  lastRoom: string | null;

  setScreen: (s: Screen) => void;
  setView: (v: TableView | null) => void;
  setBj: (v: BlackjackView | null) => void;
  setBac: (v: BaccaratView | null) => void;
  setRoom: (r: RoomInfo | null) => void;
  addChat: (m: ChatMessage) => void;
  setChat: (m: ChatMessage[]) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  set: (p: Partial<GameState>) => void;
}

let toastId = 1;

export const useGame = create<GameState>()((set, get) => ({
  screen: 'home',
  mode: null,
  view: null,
  bj: null,
  bac: null,
  hubMode: DEFAULT_GAME_MODE,
  room: null,
  chat: [],
  conn: 'idle',
  playerId: null,
  cameraMode: 'overview',
  toasts: [],
  modal: null,
  clockOffset: 0,
  onlineTab: 'create',
  pendingAction: null,
  serverRestarting: false,
  latency: null,
  lastRoom: null,

  setScreen: (screen) => set({ screen }),
  setView: (view) => {
    if (view) set({ view, bj: null, bac: null, clockOffset: view.serverTime - Date.now() });
    else set({ view: null });
  },
  setBj: (bj) => {
    if (bj) set({ bj, view: null, bac: null, clockOffset: bj.serverTime - Date.now() });
    else set({ bj: null });
  },
  setBac: (bac) => {
    if (bac) set({ bac, view: null, bj: null, clockOffset: bac.serverTime - Date.now() });
    else set({ bac: null });
  },
  setRoom: (room) => set({ room }),
  addChat: (m) => set({ chat: [...get().chat, m].slice(-80) }),
  setChat: (chat) => set({ chat }),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, text, kind }].slice(-4) });
    setTimeout(() => get().dismissToast(id), kind === 'unlock' ? 5200 : 3200);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  set: (p) => set(p),
}));
