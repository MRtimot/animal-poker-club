// 在线房间管理（与传输层无关，便于测试）。服务器是唯一的权威游戏状态。
import { GameController } from '../src/core/game/controller';
import type { SeatConfig, TableView } from '../src/core/game/view';
import {
  BLIND_OPTIONS,
  CHIP_OPTIONS,
  MAX_ROOM_PLAYERS,
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
import type { AccountState, ProgressEvent } from '../src/core/account/types';
import { effectiveBet, type GameFacts, type HandFacts } from '../src/progress/rewards';
import type { SoloSettings } from '../src/core/protocol';
import { randomId, randomRoomCode } from '../src/core/utils/random';
import { nicknameError } from '../src/core/account/types';
import { connectionLimiter } from './rateLimit';

export interface Connection {
  send(msg: ServerMessage): void;
  close?(): void;
}

/** 房间系统与账号系统之间的唯一接口：房间不直接接触数据库 */
export interface AccountLink {
  publicProfile(userId: string): PlayerProfile;
  getState(userId: string): AccountState;
  recordHand(userId: string, key: string, f: HandFacts): ProgressEvent | null;
  recordGame(userId: string, key: string, f: GameFacts): ProgressEvent | null;
}

interface Session {
  sessionId: string;
  /** 已登录玩家的账号 ID（只在服务器内部使用，从不发给客户端） */
  userId: string | null;
  playerId: string;
  profile: PlayerProfile;
  conn: Connection | null;
  roomCode: string | null;
  disconnectedAt: number | null;
  /** 上一次发给这条连接的牌局状态（用于只发送新增事件） */
  sent?: { c: GameController; conn: Connection; hand: number; seq: number; profiles: Map<string, string> };
}

interface Member extends LobbyMember {
  sessionId?: string;
  userId?: string | null;
  /** 最近处理过的动作 ID → 结果（重复发送时直接返回同样的结果，不再执行） */
  recentActions?: Map<string, string | null>;
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
  solo: boolean;
  soloSettings?: SoloSettings;
  /** 房间实例 ID + 场次：组成结算的唯一键，防止重复领奖 */
  instanceId: string;
  gameSeq: number;
}

export interface RoomServerOptions {
  /** 断线玩家在大厅中保留多久（毫秒） */
  lobbyGraceMs?: number;
  /** 无人在线的房间保留多久 */
  emptyRoomMs?: number;
  /** 游戏节奏倍率（测试用） */
  pace?: number;
  turnTimeMs?: number;
  accounts?: AccountLink | null;
}

const DIFFS: AIDifficulty[] = ['easy', 'normal', 'hard', 'expert'];

export class RoomServer {
  private sessions = new Map<string, Session>();
  private rooms = new Map<string, Room>();
  private opts: Required<Omit<RoomServerOptions, 'accounts'>>;
  private accounts: AccountLink | null;
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(opts: RoomServerOptions = {}) {
    this.opts = {
      lobbyGraceMs: opts.lobbyGraceMs ?? 60_000,
      emptyRoomMs: opts.emptyRoomMs ?? 10 * 60_000,
      pace: opts.pace ?? 1,
      turnTimeMs: opts.turnTimeMs ?? 30_000,
    };
    this.accounts = opts.accounts ?? null;
    this.sweepTimer = setInterval(() => this.sweep(), 5000);
  }

  /** 服务器即将重启：通知所有在线玩家（房间只在服务器运行期间存在） */
  notifyShutdown() {
    for (const s of this.sessions.values())
      s.conn?.send({ t: 'notice', kind: 'shutdown', message: '服务器正在重启，当前房间将会失效。请稍后重新创建房间。' });
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
  connect(conn: Connection, ctx: { userId?: string | null } = {}) {
    let session: Session | null = null;
    const userId = ctx.userId ?? null;
    const limiter = connectionLimiter();
    return {
      onMessage: (raw: string) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw);
        } catch {
          return conn.send({ t: 'error', message: '消息格式错误' });
        }
        if (!msg || typeof msg !== 'object' || typeof (msg as any).t !== 'string') return;
        // 限流：建房 / 加入、聊天、牌局动作、重连分别计数；明显刷屏直接断开
        const verdict = limiter.check(msg.t);
        if (verdict === 'flood') {
          conn.send({ t: 'error', message: '请求过于频繁，连接已断开' });
          conn.close?.();
          return;
        }
        if (verdict === 'limited') {
          if (msg.t === 'action' && typeof (msg as any).actionId === 'string')
            conn.send({ t: 'ack', actionId: String((msg as any).actionId).slice(0, 40), ok: false, message: '操作太频繁，请稍后再试' });
          else if (limiter.shouldWarn()) conn.send({ t: 'error', message: '操作太频繁，请稍后再试' });
          return;
        }
        if (msg.t === 'hello') {
          session = this.hello(conn, msg.sessionId, msg.profile, userId);
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

  private hello(conn: Connection, sessionId: string | undefined, profileIn: any, userId: string | null): Session {
    // 登录玩家：昵称、动物、等级、头像全部来自服务器数据库，忽略客户端发来的资料
    const profile = this.profileFor(userId, profileIn);
    let s = typeof sessionId === 'string' && sessionId.length <= 64 ? this.sessions.get(sessionId) : undefined;
    // 会话属于另一个账号（或账号已退出）时不能复用，防止冒用他人的座位
    if (s && s.userId && s.userId !== userId) s = undefined;
    const resumed = !!s;
    if (s) {
      s.userId = userId;
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
        userId,
        playerId: 'u_' + randomId(10),
        profile,
        conn,
        roomCode: null,
        disconnectedAt: null,
      };
      this.sessions.set(s.sessionId, s);
    }
    conn.send({ t: 'welcome', sessionId: s.sessionId, playerId: s.playerId, resumed });
    if (userId && this.accounts) {
      try {
        conn.send({ t: 'account', state: this.accounts.getState(userId) });
      } catch {
        /* 账号读取失败不影响进入房间 */
      }
    }

    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    const member = room?.members.find((m) => m.id === s!.playerId);
    if (room && member) {
      member.connected = true;
      member.userId = userId;
      if (room.status === 'lobby') member.profile = profile;
      room.emptySince = null;
      room.controller?.setConnected(member.id, true);
      this.system(room, `${member.profile.name} 重新连接了`);
      conn.send({ t: 'chatHistory', messages: room.chat });
      this.broadcastRoom(room);
      if (room.controller) this.sendState(s, room.controller, member.id, true);
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

  private profileFor(userId: string | null, p: any): PlayerProfile {
    if (userId && this.accounts) {
      try {
        return this.accounts.publicProfile(userId);
      } catch {
        /* 回落到客户端资料（仅用于显示，不影响结算） */
      }
    }
    const clean = this.cleanProfile(p);
    // 游客不能显示头像，也不能自称高等级
    clean.level = Math.min(clean.level ?? 1, 10);
    // 游客昵称同样不能冒充系统 / 管理员或包含不当内容
    if (nicknameError(clean.name)) clean.name = '玩家' + Math.floor(1000 + Math.random() * 9000);
    return clean;
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
          solo: false,
          instanceId: randomId(12),
          gameSeq: 0,
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
        if (!target || (target.solo && !target.members.some((m) => m.id === s.playerId))) return err('房间不存在，请检查房间代码');
        if (room && room !== target) this.leave(s);
        const existing = target.members.find((m) => m.id === s.playerId);
        if (existing) {
          existing.connected = true;
          s.roomCode = code;
          this.broadcastRoom(target);
          if (target.controller) this.sendState(s, target.controller, s.playerId, true);
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
        const { name, personality } = this.pushAI(room, msg.personality, msg.difficulty);
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
        const actionId = typeof msg.actionId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(msg.actionId) ? msg.actionId : null;
        const reply = (message: string | null, duplicate = false) => {
          if (actionId) s.conn?.send({ t: 'ack', actionId, ok: !message, ...(message ? { message } : {}), ...(duplicate ? { duplicate } : {}) });
          else if (message) err(message);
        };
        if (!room?.controller || !me) return reply('当前没有进行中的游戏');
        // 重复发送同一个动作：返回第一次的结果，不再执行
        if (actionId && me.recentActions?.has(actionId)) return reply(me.recentActions.get(actionId) ?? null, true);
        const remember = (r: string | null) => {
          if (!actionId) return;
          me.recentActions ??= new Map();
          me.recentActions.set(actionId, r);
          if (me.recentActions.size > 50) me.recentActions.delete(me.recentActions.keys().next().value!);
        };
        const a = msg.action;
        let result: string | null;
        if (!a || !['fold', 'check', 'call', 'raise', 'allin'].includes(a.type)) result = '无效操作';
        else if (typeof msg.hand === 'number' && msg.hand !== room.controller.engine.handNumber) result = '这一手牌已经结束';
        else
          result = room.controller.handleAction(me.id, {
            type: a.type,
            amount: typeof a.amount === 'number' && isFinite(a.amount) ? Math.floor(a.amount) : undefined,
          });
        remember(result);
        reply(result);
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
        s.profile = this.profileFor(s.userId, msg.profile);
        if (room && me) {
          if (room.status === 'lobby') {
            me.profile = s.profile;
            this.broadcastRoom(room);
          }
        }
        return;
      }
      case 'startSolo': {
        const solo = this.cleanSolo(msg.settings);
        if (!solo) return err('对局设置无效');
        if (room) this.leave(s);
        let code = randomRoomCode();
        while (this.rooms.has(code)) code = randomRoomCode();
        const r: Room = {
          code,
          hostId: s.playerId,
          settings: { maxPlayers: solo.opponents.length + 1, startingChips: solo.startingChips, smallBlind: solo.smallBlind, bigBlind: solo.bigBlind, turnSeconds: 45 },
          members: [],
          status: 'lobby',
          controller: null,
          chat: [],
          emptySince: null,
          solo: true,
          soloSettings: solo,
          instanceId: randomId(12),
          gameSeq: 0,
        };
        this.rooms.set(code, r);
        this.addHuman(r, s);
        for (const o of solo.opponents) this.pushAI(r, o.personality, o.difficulty);
        this.system(r, `欢迎来到动物扑克俱乐部！本局盲注 ${solo.smallBlind}/${solo.bigBlind}，祝你好运 🍀`);
        s.conn?.send({ t: 'chatHistory', messages: r.chat });
        this.startGame(r);
        return;
      }
      case 'restartSolo': {
        if (!room?.solo || !isHost) return err('当前不是单人对局');
        if (room.status === 'playing' && !room.controller?.isGameOver()) return err('游戏仍在进行中');
        for (const m of room.members) m.chips = room.settings.startingChips;
        this.startGame(room);
        return;
      }
      case 'resync': {
        if (room?.controller && me) this.sendState(s, room.controller, me.id, true);
        return;
      }
      case 'pause': {
        // 只有单人对局可以暂停（例如查看新手教程），多人房间不允许
        if (!room?.solo || !room.controller || !isHost) return;
        room.controller.paused = !!msg.paused;
        this.broadcastState(room);
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
    if (!(maxPlayers >= 2 && maxPlayers <= MAX_ROOM_PLAYERS)) return null;
    const startingChips = CHIP_OPTIONS.includes(Number(s.startingChips)) ? Number(s.startingChips) : 1000;
    const blinds = BLIND_OPTIONS.find(([sb, bb]) => sb === Number(s.smallBlind) && bb === Number(s.bigBlind)) ?? BLIND_OPTIONS[0];
    const turnSeconds = [15, 20, 30, 45, 60].includes(Number(s.turnSeconds)) ? Number(s.turnSeconds) : 30;
    return { maxPlayers, startingChips, smallBlind: blinds[0], bigBlind: blinds[1], turnSeconds };
  }

  private cleanSolo(x: any): SoloSettings | null {
    if (!x || !Array.isArray(x.opponents) || x.opponents.length < 1 || x.opponents.length > 7) return null;
    const startingChips = Number(x.startingChips);
    if (!CHIP_OPTIONS.includes(startingChips)) return null;
    const blinds = BLIND_OPTIONS.find(([sb, bb]) => sb === Number(x.smallBlind) && bb === Number(x.bigBlind));
    if (!blinds) return null;
    const opponents = x.opponents.map((o: any) => ({
      personality: (o?.personality in PERSONALITIES ? o.personality : 'smartCat') as AIPersonality,
      difficulty: (DIFFS.includes(o?.difficulty) ? o.difficulty : 'easy') as AIDifficulty,
    }));
    return { opponents, startingChips, smallBlind: blinds[0], bigBlind: blinds[1] };
  }

  private pushAI(room: Room, p: any, d: any) {
    const personality: AIPersonality = p in PERSONALITIES ? p : 'smartCat';
    const difficulty: AIDifficulty = DIFFS.includes(d) ? d : 'normal';
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
    return { name, personality };
  }

  private addHuman(room: Room, s: Session) {
    room.members.push({
      id: s.playerId,
      sessionId: s.sessionId,
      userId: s.userId,
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
    room.gameSeq++;
    const gameKey = `${room.instanceId}:${room.gameSeq}`;
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
    // 每一手牌结束：服务器根据牌桌真实状态为登录玩家结算（客户端不参与计算）
    c.onHandComplete = () => {
      if (room.controller !== c) return;
      this.settleHand(room, c, gameKey);
    };
    c.subscribe(() => {
      if (room.controller !== c) return;
      this.broadcastState(room);
      if (c.isGameOver() && room.status === 'playing') {
        room.status = 'finished';
        this.settleGame(room, c, gameKey);
        this.broadcastRoom(room);
      }
    });
    if (!room.solo) this.system(room, '游戏开始！祝大家好运 🍀');
    this.broadcastRoom(room);
    c.start();
  }

  // ───────────── 结算（交给账号系统） ─────────────

  private settleHand(room: Room, c: GameController, gameKey: string) {
    if (!this.accounts) return;
    for (const m of room.members) {
      if (m.isAI || !m.userId) continue;
      const v = c.getView(m.id);
      const me = v.players.find((p) => p.id === m.id);
      const sum = v.summary;
      if (!me || !sum || !me.inHand) continue;
      const win = sum.winners.find((w) => w.playerId === m.id);
      const shown = sum.shown.find((h) => h.playerId === m.id);
      try {
        const ev = this.accounts.recordHand(m.userId, `${gameKey}:${sum.handNumber}`, {
          won: !!win,
          amount: win?.amount ?? 0,
          bet: effectiveBet(me.totalBet, v.events as any, m.id),
          category: win && shown ? shown.category : -1,
          allIn: me.allIn,
          folded: me.folded,
          uncontested: sum.uncontested,
          species: m.profile.animal.species,
          online: !room.solo,
        });
        if (ev) this.pushProgress(m.userId, ev);
      } catch (err) {
        console.error('[结算] 保存牌局结果失败', err);
      }
    }
  }

  private settleGame(room: Room, c: GameController, gameKey: string) {
    if (!this.accounts) return;
    const v0 = c.getView('');
    const go = v0.gameOver;
    if (!go) return;
    for (const m of room.members) {
      if (m.isAI || !m.userId) continue;
      const rank = go.rankings.find((r) => r.playerId === m.id);
      if (!rank) continue;
      try {
        const ev = this.accounts.recordGame(m.userId, gameKey, {
          place: rank.place,
          players: go.rankings.length,
          hands: v0.handNumber,
          finalChips: rank.chips,
          mode: room.solo ? 'local' : 'online',
        });
        if (ev) this.pushProgress(m.userId, ev);
      } catch (err) {
        console.error('[结算] 保存比赛结果失败', err);
      }
    }
  }

  private pushProgress(userId: string, event: ProgressEvent) {
    if (!this.accounts) return;
    const state = this.accounts.getState(userId);
    this.sendToUser(userId, { t: 'progress', event, state });
    // 升级后同步牌桌上显示的等级
    if (event.levelAfter !== event.levelBefore) this.refreshUserProfile(userId);
  }

  private sendToUser(userId: string, msg: ServerMessage) {
    for (const s of this.sessions.values()) if (s.userId === userId && s.conn) s.conn.send(msg);
  }

  /** 账号数据在其他地方被修改（其他设备、HTTP 接口）：推送给该玩家所有在线设备 */
  notifyAccount(userId: string, state: AccountState) {
    this.sendToUser(userId, { t: 'account', state });
    this.refreshUserProfile(userId);
  }

  /** 账号被删除：断开账号绑定，玩家变回游客 */
  dropUser(userId: string) {
    for (const s of this.sessions.values()) {
      if (s.userId !== userId) continue;
      s.userId = null;
      s.conn?.send({ t: 'account', state: null });
    }
    for (const room of this.rooms.values()) for (const m of room.members) if (m.userId === userId) m.userId = null;
  }

  private refreshUserProfile(userId: string) {
    if (!this.accounts) return;
    let profile: PlayerProfile;
    try {
      profile = this.accounts.publicProfile(userId);
    } catch {
      return;
    }
    for (const s of this.sessions.values()) {
      if (s.userId !== userId) continue;
      s.profile = profile;
      const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
      const m = room?.members.find((x) => x.id === s.playerId);
      if (room && m && room.status === 'lobby') {
        m.profile = profile;
        this.broadcastRoom(room);
      }
    }
  }

  // ───────────── 广播 ─────────────

  roomInfo(room: Room): RoomInfo {
    const chipsMap = new Map(room.controller?.engine.players.map((p) => [p.id, p.chips]) ?? []);
    return {
      code: room.code,
      hostId: room.hostId,
      settings: room.settings,
      status: room.status,
      ...(room.solo ? { solo: true } : {}),
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
      if (s?.conn) this.sendState(s, c, m.id);
    }
  }

  /**
   * 发送某位玩家的牌局视图。同一手牌内只附带新增的事件（下注、发牌、摊牌…），
   * 不重复发送整手牌的事件记录；也从不发送镜头、动画或 3D 数据。
   */
  private sendState(s: Session, c: GameController, id: string, full = false) {
    if (!s.conn) return;
    const view = c.getView(id);
    const lastSeq = view.events.length ? view.events[view.events.length - 1].seq : (s.sent?.seq ?? 0);
    const firstSeq = view.events[0]?.seq ?? 0;
    const prev = s.sent;
    const profiles = new Map(view.players.map((p) => [p.id, JSON.stringify(p.profile)]));
    let out: TableView = view;
    if (!full && prev && prev.c === c && prev.conn === s.conn && prev.hand === view.handNumber && prev.seq >= firstSeq - 1) {
      out = {
        ...view,
        events: view.events.filter((e) => e.seq > prev.seq),
        // 动物外观在牌局中几乎不变：没变化就不重复发送，客户端沿用上一次的
        players: view.players.map((p) => (prev.profiles.get(p.id) === profiles.get(p.id) ? ({ ...p, profile: undefined } as unknown as typeof p) : p)),
        eventsDelta: true,
      };
    }
    s.sent = { c, conn: s.conn, hand: view.handNumber, seq: lastSeq, profiles };
    s.conn.send({ t: 'state', view: out });
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
