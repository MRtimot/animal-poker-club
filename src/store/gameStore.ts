import { create } from 'zustand';
import type { TableView } from '../core/game/view';
import type { ChatMessage, RoomInfo } from '../core/protocol';

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
  view: TableView | null;
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

  setScreen: (s: Screen) => void;
  setView: (v: TableView | null) => void;
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

  setScreen: (screen) => set({ screen }),
  setView: (view) => {
    if (view) set({ view, clockOffset: view.serverTime - Date.now() });
    else set({ view: null });
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
