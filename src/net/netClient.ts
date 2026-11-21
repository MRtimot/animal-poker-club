// 在线客户端：自建 WebSocket 服务器连接、自动重连、状态同步（无任何第三方服务）
import type { ClientMessage, RoomSettings, ServerMessage, SoloSettings } from '../core/protocol';
import { onIdentityChanged, onServerAccount, onServerProgress } from '../store/accountStore';
import type { PlayerAction } from '../core/table/types';
import type { AIDifficulty, AIPersonality } from '../core/ai/ai';
import { useGame } from '../store/gameStore';
import { currentProfile } from '../store/profileStore';
import { safeStorage } from '../utils/format';
import { serverWsUrl } from './serverAddress';

const SESSION_KEY = 'apc-session';
const LAST_ROOM_KEY = 'apc-last-room';

/**
 * 在线会话保存在 sessionStorage：每个浏览器标签页是一名独立玩家，刷新页面仍能回到原来的座位。
 * （localStorage 会让同一浏览器的两个标签页共用一个座位，互相挤掉）
 */
function tabStorage(): Storage | undefined {
  try {
    const s = window.sessionStorage;
    s.getItem('x');
    return s;
  } catch {
    return safeStorage();
  }
}

let actionSeq = 0;
const newActionId = () => `a${Date.now().toString(36)}${(actionSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

class NetClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: number | null = null;
  private queue: ClientMessage[] = [];
  private wanted = false;
  private pingTimer: number | null = null;

  url(): string {
    return serverWsUrl();
  }

  get sessionId(): string | undefined {
    return tabStorage()?.getItem(SESSION_KEY) ?? undefined;
  }

  connect() {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const g = useGame.getState();
    g.set({ conn: 'connecting' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      g.set({ conn: 'disconnected' });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw({ t: 'hello', sessionId: this.sessionId, profile: currentProfile() });
      const q = this.queue;
      this.queue = [];
      q.forEach((m) => this.raw(m));
      this.pingTimer = window.setInterval(() => this.raw({ t: 'ping', time: Date.now() }), 20000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.ws === ws) this.ws = null;
      useGame.getState().set({ conn: 'disconnected' });
      if (this.wanted) this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose 会处理 */
    };
  }

  private scheduleReconnect() {
    if (this.retryTimer) return;
    const delay = Math.min(8000, 500 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.wanted) this.connect();
    }, delay);
  }

  disconnect() {
    this.wanted = false;
    this.ws?.close();
    this.ws = null;
  }

  /** 登录 / 退出后重新连接，让服务器用新的身份识别这条连接 */
  reconnect() {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onclose = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    ws.close();
    tabStorage()?.removeItem(SESSION_KEY);
    this.connect();
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private raw(m: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else this.queue.push(m);
  }

  send(m: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
      this.queue.push(m);
      return;
    }
    this.raw(m);
  }

  private handle(msg: ServerMessage) {
    const g = useGame.getState();
    switch (msg.t) {
      case 'welcome': {
        tabStorage()?.setItem(SESSION_KEY, msg.sessionId);
        g.set({ conn: 'connected', playerId: msg.playerId, pendingAction: null, serverRestarting: false });
        // 服务器重启后旧会话不存在：房间已经消失，友好地告诉玩家（房间只在服务器运行期间存在）
        const lastRoom = tabStorage()?.getItem(LAST_ROOM_KEY);
        if (msg.resumed === false && lastRoom) {
          tabStorage()?.removeItem(LAST_ROOM_KEY);
          g.toast(`房间 ${lastRoom} 已失效：服务器刚刚重启过。在线房间只在服务器运行期间存在，请重新创建房间。`, 'error');
          if (g.mode === 'online') {
            g.set({ mode: null, view: null, room: null, chat: [] });
            if (g.screen === 'room' || g.screen === 'game') g.setScreen('online');
          }
        }
        break;
      }
      case 'ack': {
        const p = g.pendingAction;
        if (p && p.id === msg.actionId) g.set({ pendingAction: null });
        if (!msg.ok && !msg.duplicate && msg.message) g.toast(msg.message, 'error');
        break;
      }
      case 'notice':
        g.set({ serverRestarting: true });
        g.toast(msg.message, 'error');
        break;
      case 'room': {
        const prev = g.room;
        g.setRoom(msg.room);
        if (msg.room) tabStorage()?.setItem(LAST_ROOM_KEY, msg.room.code);
        else tabStorage()?.removeItem(LAST_ROOM_KEY);
        if (!msg.room) {
          if (g.mode === 'online') {
            g.set({ mode: null, view: null });
            if (g.screen === 'room' || g.screen === 'game') g.setScreen(prev?.solo ? 'quick' : 'online');
          }
          return;
        }
        g.set({ mode: 'online' });
        this.soloWaiter?.(true);
        if (msg.room.solo) {
          if (g.screen !== 'game') g.setScreen('game');
          break;
        }
        if (msg.room.status === 'lobby') {
          if (g.screen === 'game' || g.screen === 'online' || !prev || prev.code !== msg.room.code || g.screen === 'home') {
            g.set({ view: null });
            g.setScreen('room');
          }
        } else if (g.screen !== 'game') {
          g.setScreen('game');
        }
        break;
      }
      case 'state': {
        let view = msg.view;
        if (view.eventsDelta) {
          // 只收到了新增事件：追加到本手牌已有的事件后面
          const prev = g.view;
          const prevLast = prev?.events.length ? prev.events[prev.events.length - 1].seq : 0;
          const firstNew = view.events[0]?.seq;
          if (!prev || prev.handNumber !== view.handNumber || (firstNew !== undefined && firstNew > prevLast + 1)) {
            this.send({ t: 'resync' });
            if (!prev) break;
          }
          const base = prev && prev.handNumber === view.handNumber ? prev.events : [];
          const prevProfiles = new Map(prev?.players.map((p) => [p.id, p.profile]) ?? []);
          view = {
            ...view,
            events: [...base, ...view.events.filter((e) => e.seq > prevLast)],
            players: view.players.map((p) => (p.profile ? p : { ...p, profile: prevProfiles.get(p.id)! })),
            eventsDelta: undefined,
          };
        }
        g.setView(view);
        // 轮到别人了：之前的动作一定已经处理完
        if (g.pendingAction && view.currentPlayerId !== view.viewerId) g.set({ pendingAction: null });
        if (g.screen !== 'game') g.setScreen('game');
        break;
      }
      case 'chat':
        g.addChat(msg.message);
        break;
      case 'chatHistory':
        g.setChat(msg.messages);
        break;
      case 'error':
        g.toast(msg.message, 'error');
        break;
      case 'pong':
        break;
      case 'account':
        onServerAccount(msg.state);
        break;
      case 'progress':
        onServerProgress(msg.event, msg.state);
        break;
    }
  }

  private soloWaiter: ((ok: boolean) => void) | null = null;

  /** 与 AI 对战（在服务器上运行，由服务器结算奖励）。服务器无法连接时返回 false */
  startSolo(settings: SoloSettings, timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.soloWaiter = null;
        resolve(false);
      }, timeoutMs);
      this.soloWaiter = (ok) => {
        clearTimeout(timer);
        this.soloWaiter = null;
        resolve(ok);
      };
      const g = useGame.getState();
      g.set({ chat: [], view: null });
      this.send({ t: 'startSolo', settings });
    });
  }
  restartSolo() {
    this.send({ t: 'restartSolo' });
  }
  pause(paused: boolean) {
    if (this.ws?.readyState === WebSocket.OPEN) this.raw({ t: 'pause', paused });
  }

  // ───────────── 便捷方法 ─────────────
  createRoom(settings: RoomSettings) {
    this.send({ t: 'createRoom', settings });
  }
  joinRoom(code: string) {
    this.send({ t: 'joinRoom', code });
  }
  leaveRoom() {
    this.send({ t: 'leaveRoom' });
    const g = useGame.getState();
    g.set({ room: null, view: null, mode: null, chat: [] });
  }
  ready(ready: boolean) {
    this.send({ t: 'ready', ready });
  }
  addAI(personality: AIPersonality, difficulty: AIDifficulty) {
    this.send({ t: 'addAI', personality, difficulty });
  }
  removeMember(id: string) {
    this.send({ t: 'removeMember', id });
  }
  startGame() {
    this.send({ t: 'startGame' });
  }
  /** 发送牌局动作：带 actionId（重复点击只执行一次）和手数（过期动作会被服务器拒绝），等待服务器确认 */
  action(action: PlayerAction, hand?: number) {
    const g = useGame.getState();
    if (g.pendingAction) return;
    const id = newActionId();
    g.set({ pendingAction: { id, type: action.type, at: Date.now() } });
    this.send({ t: 'action', action, actionId: id, hand });
    // 网络异常时不让按钮永远卡在“处理中”
    window.setTimeout(() => {
      if (useGame.getState().pendingAction?.id === id) useGame.getState().set({ pendingAction: null });
    }, 6000);
  }
  chat(text: string) {
    this.send({ t: 'chat', text });
  }
  emote(emoji: string) {
    this.send({ t: 'emote', emoji });
  }
  updateProfile() {
    if (this.ws?.readyState === WebSocket.OPEN) this.raw({ t: 'updateProfile', profile: currentProfile() });
  }
  backToLobby() {
    this.send({ t: 'backToLobby' });
  }
}

export const net = new NetClient();
onIdentityChanged(() => net.reconnect());
