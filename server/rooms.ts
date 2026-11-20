// 在线房间管理（与传输层无关，便于测试）。服务器是唯一的权威游戏状态。
import { GameController } from '../src/core/game/controller';
import type { SeatConfig } from '../src/core/game/view';
import {
  BLIND_OPTIONS,
  CHIP_OPTIONS,
  EMOTES,
  type ChatMessage,
  type ClientMessage,
  type LobbyMember,
  type RoomInfo,
  type RoomSettings,
  type ServerMessage,
} from '../src/core/protocol';
import { AI_NAMES, PERSONALITIES, type AIDifficulty, type AIPersonality } from '../src/core/ai/ai';
import { randomAnimal, sanitizeAnimal, sanitizeName, type PlayerProfile } from '../src/core/player/profile';
import { randomId, randomRoomCode } from '../src/core/utils/random';

export interface Connection {
  send(msg: ServerMessage): void;
  close?(): void;
}

interface Session {
  sessionId: string;
  playerId: string;
  profile: PlayerProfile;
  conn: Connection | null;
  roomCode: string | null;
  disconnectedAt: number | null;
}

interface Member extends LobbyMember {
  sessionId?: string;
}

interface Room {
  code: string;
  hostId: string;
  settings: RoomSettings;
  members: Member[];
  status: RoomInfo['status'];
  controller: GameController | null;
  chat: ChatMessage[];
  emptySince: number | null;
}

export interface RoomServerOptions {
  /** 断线玩家在大厅中保留多久（毫秒） */
  lobbyGraceMs?: number;
  /** 无人在线的房间保留多久 */
  emptyRoomMs?: number;
  /** 游戏节奏倍率（测试用） */
  pace?: number;
  turnTimeMs?: number;
}

const DIFFS: AIDifficulty[] = ['easy', 'normal', 'hard', 'expert'];

export class RoomServer {
  private sessions = new Map<string, Session>();
  private rooms = new Map<string, Room>();
  private opts: Required<RoomServerOptions>;
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(opts: RoomServerOptions = {}) {
    this.opts = {
      lobbyGraceMs: opts.lobbyGraceMs ?? 60_000,
      emptyRoomMs: opts.emptyRoomMs ?? 10 * 60_000,
      pace: opts.pace ?? 1,
      turnTimeMs: opts.turnTimeMs ?? 30_000,
    };
    this.sweepTimer = setInterval(() => this.sweep(), 5000);
  }

  dispose() {
    clearInterval(this.sweepTimer);
    for (const r of this.rooms.values()) r.controller?.stop();
  }

  get roomCount() {
    return this.rooms.size;
  }

  getRoom(code: string) {
    return this.rooms.get(code);
  }

  /** 新连接：返回该连接的消息处理器与关闭回调 */
  connect(conn: Connection) {
    let session: Session | null = null;
    return {
      onMessage: (raw: string) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw);
        } catch {
          return conn.send({ t: 'error', message: '消息格式错误' });
        }
        if (!msg || typeof msg !== 'object' || typeof (msg as any).t !== 'string') return;
        if (msg.t === 'hello') {
          session = this.hello(conn, msg.sessionId, msg.profile);
          return;
        }
        if (msg.t === 'ping') {
          conn.send({ t: 'pong', time: msg.time, serverTime: Date.now() });
          return;
        }
        if (!session) return conn.send({ t: 'error', message: '请先连接服务器' });
        try {
          this.handle(session, msg);
        } catch (err) {
          console.error('[房间] 处理消息出错', err);
          conn.send({ t: 'error', message: '服务器处理失败' });
        }
      },
      onClose: () => {
        if (session && session.conn === conn) this.disconnect(session);
      },
    };
  }

  // ───────────── 会话 ─────────────

  private hello(conn: Connection, sessionId: string | undefined, profileIn: any): Session {
    const profile = this.cleanProfile(profileIn);
    let s = sessionId ? this.sessions.get(sessionId) : undefined;
    if (s) {
      // 断线重连：替换旧连接
      if (s.conn && s.conn !== conn) {
        try {
          s.conn.send({ t: 'error', message: '你已在其他页面登录，本页面已断开' });
          s.conn.close?.();
        } catch {
          /* ignore */
        }
      }
      s.conn = conn;
      s.disconnectedAt = null;
      s.profile = profile;
    } else {
      s = {
        sessionId: randomId(24),
        playerId: 'u_' + randomId(10),
        profile,
        conn,
        roomCode: null,
        disconnectedAt: null,
      };
      this.sessions.set(s.sessionId, s);
    }
    conn.send({ t: 'welcome', sessionId: s.sessionId, playerId: s.playerId });

    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    const member = room?.members.find((m) => m.id === s!.playerId);
    if (room && member) {
      member.connected = true;
      if (room.status === 'lobby') member.profile = profile;
      room.emptySince = null;
      room.controller?.setConnected(member.id, true);
      this.system(room, `${member.profile.name} 重新连接了`);
      conn.send({ t: 'chatHistory', messages: room.chat });
      this.broadcastRoom(room);
      if (room.controller) conn.send({ t: 'state', view: room.controller.getView(member.id) });
    } else {
      s.roomCode = null;
      conn.send({ t: 'room', room: null });
    }
    return s;
  }

  private disconnect(s: Session) {
    s.conn = null;
    s.disconnectedAt = Date.now();
    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    if (!room) return;
    const m = room.members.find((x) => x.id === s.playerId);
    if (!m) return;
    m.connected = false;
    room.controller?.setConnected(m.id, false);
    this.system(room, `${m.profile.name} 断线了`);
    if (!room.members.some((x) => !x.isAI && x.connected)) room.emptySince = Date.now();
    this.broadcastRoom(room);
  }

  private sweep() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.emptySince && now - room.emptySince > this.opts.emptyRoomMs) {
        this.destroyRoom(room);
        continue;
      }
      if (room.status === 'lobby') {
        for (const m of [...room.members]) {
          if (m.isAI || m.connected) continue;
          const s = m.sessionId ? this.sessions.get(m.sessionId) : undefined;
          if (!s || (s.disconnectedAt && now - s.disconnectedAt > this.opts.lobbyGraceMs)) {
            this.removeMember(room, m.id, '长时间离线，已移出房间');
          }
        }
      }
    }
    // 清理长时间不用的会话
    for (const [id, s] of this.sessions) {
      if (!s.conn && !s.roomCode && s.disconnectedAt && now - s.disconnectedAt > 30 * 60_000) this.sessions.delete(id);
    }
  }

  private cleanProfile(p: any): PlayerProfile {
    return {
      name: sanitizeName(p?.name),
      animal: sanitizeAnimal(p?.animal),
      level: typeof p?.level === 'number' ? Math.max(1, Math.min(999, Math.floor(p.level))) : 1,
    };
  }

  // ───────────── 消息处理 ─────────────

  private handle(s: Session, msg: ClientMessage) {
    const err = (message: string) => s.conn?.send({ t: 'error', message });
    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    const me = room?.members.find((m) => m.id === s.playerId);
    const isHost = !!room && room.hostId === s.playerId;

    switch (msg.t) {
      case 'createRoom': {
        if (room) this.leave(s);
        const settings = this.cleanSettings(msg.settings);
        if (!settings) return err('房间设置无效');
        let code = randomRoomCode();
        while (this.rooms.has(code)) code = randomRoomCode();
        const r: Room = {
          code,
          hostId: s.playerId,
          settings,
          members: [],
          status: 'lobby',
          controller: null,
          chat: [],
          emptySince: null,
        };
        this.rooms.set(code, r);
        this.addHuman(r, s);
        this.system(r, `房间 ${code} 已创建，把房间代码发给朋友吧！`);
        s.conn?.send({ t: 'chatHistory', messages: r.chat });
        this.broadcastRoom(r);
        return;
      }
      case 'joinRoom': {
        const code = String(msg.code ?? '').trim().toUpperCase();
        const target = this.rooms.get(code);
        if (!target) return err('房间不存在，请检查房间代码');
        if (room && room !== target) this.leave(s);
        const existing = target.members.find((m) => m.id === s.playerId);
        if (existing) {
          existing.connected = true;
          s.roomCode = code;
          this.broadcastRoom(target);
          if (target.controller) s.conn?.send({ t: 'state', view: target.controller.getView(s.playerId) });
          return;
        }
        if (target.status !== 'lobby') return err('游戏已经开始，暂时无法加入');
        if (target.members.length >= target.settings.maxPlayers) return err('房间已满');
        this.addHuman(target, s);
        this.system(target, `${s.profile.name} 加入了房间`);
        s.conn?.send({ t: 'chatHistory', messages: target.chat });
        this.broadcastRoom(target);
        return;
      }
      case 'leaveRoom':
        if (room) this.leave(s);
        s.conn?.send({ t: 'room', room: null });
        return;
      case 'ready':
        if (!room || !me || room.status !== 'lobby') return;
        me.ready = !!msg.ready;
        this.broadcastRoom(room);
        return;
      case 'addAI': {
        if (!room || !isHost) return err('只有房主可以添加 AI');
        if (room.status !== 'lobby') return err('游戏进行中无法添加 AI');
        if (room.members.length >= room.settings.maxPlayers) return err('房间已满');
        const personality: AIPersonality = msg.personality in PERSONALITIES ? msg.personality : 'smartCat';
        const difficulty: AIDifficulty = DIFFS.includes(msg.difficulty) ? msg.difficulty : 'normal';
        const used = new Set(room.members.map((m) => m.profile.name));
        const name = AI_NAMES[personality].find((n) => !used.has(n)) ?? PERSONALITIES[personality].name + room.members.length;
        const animal = randomAnimal(Math.random, [PERSONALITIES[personality].species]);
        room.members.push({
          id: 'ai_' + randomId(8),
          profile: { name, animal, level: 1 },
          isAI: true,
          aiPersonality: personality,
          aiDifficulty: difficulty,
          ready: true,
          connected: true,
          isHost: false,
          chips: room.settings.startingChips,
        });
        this.system(room, `${name}（${PERSONALITIES[personality].name} · AI）加入了牌桌`);
        this.broadcastRoom(room);
        return;
      }
      case 'removeMember': {
        if (!room || !isHost) return err('只有房主可以移除玩家');
        if (room.status !== 'lobby') return err('游戏进行中无法移除玩家');
        if (msg.id === s.playerId) return;
        const target = room.members.find((m) => m.id === msg.id);
        if (!target) return;
        this.removeMember(room, target.id, target.isAI ? '已被移出牌桌' : '已被房主移出房间');
        return;
      }
      case 'startGame': {
        if (!room || !isHost) return err('只有房主可以开始游戏');
        if (room.status === 'playing') return err('游戏已经开始');
        if (room.members.length < 2) return err('至少需要 2 名玩家（可以添加 AI）');
        const notReady = room.members.filter((m) => !m.isAI && !m.ready && m.id !== room.hostId);
        if (notReady.length) return err(`还有玩家没有准备：${notReady.map((m) => m.profile.name).join('、')}`);
        this.startGame(room);
        return;
      }
      case 'action': {
        if (!room?.controller || !me) return err('当前没有进行中的游戏');
        const a = msg.action;
        if (!a || !['fold', 'check', 'call', 'raise', 'allin'].includes(a.type)) return err('无效操作');
        const e = room.controller.handleAction(me.id, {
          type: a.type,
          amount: typeof a.amount === 'number' && isFinite(a.amount) ? Math.floor(a.amount) : undefined,
        });
        if (e) err(e);
        return;
      }
      case 'chat': {
        if (!room || !me) return;
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);
        if (!text) return;
        this.pushChat(room, { from: me.id, name: me.profile.name, text, kind: 'chat' });
        return;
      }
      case 'emote': {
        if (!room || !me) return;
        if (!EMOTES.includes(msg.emoji)) return;
        this.pushChat(room, { from: me.id, name: me.profile.name, text: msg.emoji, kind: 'emote' });
        return;
      }
      case 'updateProfile': {
        s.profile = this.cleanProfile(msg.profile);
        if (room && me) {
          if (room.status === 'lobby') {
            me.profile = s.profile;
            this.broadcastRoom(room);
          }
        }
        return;
      }
      case 'backToLobby': {
        if (!room || !isHost) return err('只有房主可以返回大厅');
        if (room.status === 'playing' && !room.controller?.isGameOver()) return err('游戏仍在进行中');
        room.controller?.stop();
        room.controller = null;
        room.status = 'lobby';
        room.members = room.members.filter((m) => m.isAI || m.connected);
        for (const m of room.members) {
          m.ready = m.isAI;
          m.chips = room.settings.startingChips;
        }
        this.system(room, '房主将大家带回了大厅');
        this.broadcastRoom(room);
        return;
      }
    }
  }

  private cleanSettings(s: any): RoomSettings | null {
    if (!s) return null;
    const maxPlayers = Math.floor(Number(s.maxPlayers));
    if (!(maxPlayers >= 2 && maxPlayers <= 8)) return null;
    const startingChips = CHIP_OPTIONS.includes(Number(s.startingChips)) ? Number(s.startingChips) : 1000;
    const blinds = BLIND_OPTIONS.find(([sb, bb]) => sb === Number(s.smallBlind) && bb === Number(s.bigBlind)) ?? BLIND_OPTIONS[0];
    const turnSeconds = [15, 20, 30, 45, 60].includes(Number(s.turnSeconds)) ? Number(s.turnSeconds) : 30;
    return { maxPlayers, startingChips, smallBlind: blinds[0], bigBlind: blinds[1], turnSeconds };
  }

  private addHuman(room: Room, s: Session) {
    room.members.push({
      id: s.playerId,
      sessionId: s.sessionId,
      profile: s.profile,
      isAI: false,
      ready: false,
      connected: !!s.conn,
      isHost: room.hostId === s.playerId,
      chips: room.settings.startingChips,
    });
    s.roomCode = room.code;
    room.emptySince = null;
  }

  private leave(s: Session) {
    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    s.roomCode = null;
    if (!room) return;
    this.removeMember(room, s.playerId, '离开了房间');
  }

  private removeMember(room: Room, id: string, reason: string) {
    const m = room.members.find((x) => x.id === id);
    if (!m) return;
    if (room.controller && room.status === 'playing') room.controller.removePlayer(id);
    room.members = room.members.filter((x) => x.id !== id);
    if (m.sessionId) {
      const s = this.sessions.get(m.sessionId);
      if (s && s.roomCode === room.code) {
        s.roomCode = null;
        s.conn?.send({ t: 'room', room: null });
      }
    }
    this.system(room, `${m.profile.name} ${reason}`);
    const humans = room.members.filter((x) => !x.isAI);
    if (humans.length === 0) {
      this.destroyRoom(room);
      return;
    }
    if (room.hostId === id) {
      const next = humans.find((x) => x.connected) ?? humans[0];
      room.hostId = next.id;
      this.system(room, `${next.profile.name} 成为了新房主`);
    }
    this.broadcastRoom(room);
  }

  private destroyRoom(room: Room) {
    room.controller?.stop();
    this.rooms.delete(room.code);
    for (const m of room.members) {
      const s = m.sessionId ? this.sessions.get(m.sessionId) : undefined;
      if (s && s.roomCode === room.code) s.roomCode = null;
    }
  }

  private startGame(room: Room) {
    room.controller?.stop();
    const seats: SeatConfig[] = room.members.map((m) => ({
      id: m.id,
      profile: m.profile,
      chips: room.settings.startingChips,
      isAI: m.isAI,
      aiPersonality: m.aiPersonality,
      aiDifficulty: m.aiDifficulty,
    }));
    const c = new GameController(seats, {
      smallBlind: room.settings.smallBlind,
      bigBlind: room.settings.bigBlind,
      turnTimeMs: this.opts.turnTimeMs === 30_000 ? room.settings.turnSeconds * 1000 : this.opts.turnTimeMs,
      pace: this.opts.pace,
    });
    room.controller = c;
    room.status = 'playing';
    for (const m of room.members) if (!m.isAI && !m.connected) c.setConnected(m.id, false);
    c.onChat = (playerId, kind, text) => {
      const m = room.members.find((x) => x.id === playerId);
      if (m) this.pushChat(room, { from: playerId, name: m.profile.name, text, kind });
    };
    c.subscribe(() => {
      if (room.controller !== c) return;
      this.broadcastState(room);
      if (c.isGameOver() && room.status === 'playing') {
        room.status = 'finished';
        this.broadcastRoom(room);
      }
    });
    this.system(room, '游戏开始！祝大家好运 🍀');
    this.broadcastRoom(room);
    c.start();
  }

  // ───────────── 广播 ─────────────

  roomInfo(room: Room): RoomInfo {
    const chipsMap = new Map(room.controller?.engine.players.map((p) => [p.id, p.chips]) ?? []);
    return {
      code: room.code,
      hostId: room.hostId,
      settings: room.settings,
      status: room.status,
      members: room.members.map((m) => ({
        id: m.id,
        profile: m.profile,
        isAI: m.isAI,
        aiPersonality: m.aiPersonality,
        aiDifficulty: m.aiDifficulty,
        ready: m.isAI || m.ready || m.id === room.hostId,
        connected: m.connected,
        isHost: m.id === room.hostId,
        chips: chipsMap.get(m.id) ?? m.chips,
      })),
    };
  }

  private broadcastRoom(room: Room) {
    const info = this.roomInfo(room);
    for (const m of room.members) {
      if (m.isAI) continue;
      const s = m.sessionId ? this.sessions.get(m.sessionId) : undefined;
      s?.conn?.send({ t: 'room', room: info });
    }
  }

  private broadcastState(room: Room) {
    const c = room.controller;
    if (!c) return;
    for (const m of room.members) {
      if (m.isAI) continue;
      const s = m.sessionId ? this.sessions.get(m.sessionId) : undefined;
      if (s?.conn) s.conn.send({ t: 'state', view: c.getView(m.id) });
    }
  }

  private pushChat(room: Room, partial: Omit<ChatMessage, 'id' | 'time'>) {
    const message: ChatMessage = { ...partial, id: randomId(8), time: Date.now() };
    room.chat.push(message);
    if (room.chat.length > 60) room.chat.shift();
    for (const m of room.members) {
      if (m.isAI) continue;
      const s = m.sessionId ? this.sessions.get(m.sessionId) : undefined;
      s?.conn?.send({ t: 'chat', message });
    }
  }

  private system(room: Room, text: string) {
    this.pushChat(room, { from: 'system', name: '系统', text, kind: 'system' });
  }
}
