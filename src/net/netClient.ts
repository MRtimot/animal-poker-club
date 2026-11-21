// 在线客户端：自建 WebSocket 服务器连接、自动重连、状态同步（无任何第三方服务）
import type { ClientMessage, RoomSettings, ServerMessage, SoloSettings } from '../core/protocol';
import { onIdentityChanged, onServerAccount, onServerProgress } from '../store/accountStore';
import type { PlayerAction } from '../core/table/types';
import type { AIDifficulty, AIPersonality } from '../core/ai/ai';
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { currentProfile } from '../store/profileStore';
import { safeStorage } from '../utils/format';

const SESSION_KEY = 'apc-session';

class NetClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: number | null = null;
  private queue: ClientMessage[] = [];
  private wanted = false;
  private pingTimer: number | null = null;

  url(): string {
    const custom = useSettings.getState().serverUrl.trim();
    if (custom) {
      let u = custom.replace(/^http/, 'ws');
      if (!/^wss?:\/\//.test(u)) u = 'ws://' + u;
      if (!u.endsWith('/ws')) u = u.replace(/\/$/, '') + '/ws';
      return u;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  get sessionId(): string | undefined {
    return safeStorage()?.getItem(SESSION_KEY) ?? undefined;
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
    safeStorage()?.removeItem(SESSION_KEY);
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
      case 'welcome':
        safeStorage()?.setItem(SESSION_KEY, msg.sessionId);
        g.set({ conn: 'connected', playerId: msg.playerId });
        break;
      case 'room': {
        const prev = g.room;
        g.setRoom(msg.room);
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
      case 'state':
        g.setView(msg.view);
        if (g.screen !== 'game') g.setScreen('game');
        break;
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
  action(action: PlayerAction) {
    this.send({ t: 'action', action });
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
