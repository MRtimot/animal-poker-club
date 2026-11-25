// 在线房间管理（与传输层无关，便于测试）。服务器是唯一的权威游戏状态。
//
// 支持“多台服务器共享房间”（Vercel 上同一时间可能有多个函数实例，玩家可能连到不同实例）：
// - 房间状态（成员、牌局、聊天）保存在共享存储中（单机：内存；Vercel：Redis）
// - 每次修改：读取 → 修改 → 按版本号写回（冲突则重试）→ 发布事件
// - 每台服务器收到事件后，只把更新发给“连在自己身上”的玩家
// - 牌局计时（发牌、AI 思考、行动超时）由有玩家在线的服务器到点推进，任何一台都可以接手
import { GameController } from '../src/core/game/controller';
import type { SeatConfig, TableView } from '../src/core/game/view';
import type { ControllerState } from '../src/core/game/controller';
import { BlackjackController, type BlackjackState } from '../src/core/blackjack/controller';
import { isDealerChoice, pickDealer } from '../src/core/blackjack/dealers';
import { REFILL_CHIPS, tierById } from '../src/core/blackjack/rules';
import { DEALER_ID, type BjRoundFacts, type BlackjackView } from '../src/core/blackjack/types';
import { GAME_MODES, gameModeOf, isGameMode } from '../src/core/gameMode';
import {
  BLIND_OPTIONS,
  CHIP_OPTIONS,
  MAX_ROOM_PLAYERS,
  EMOTES,
  PROTOCOL_VERSION,
  type ChatMessage,
  type ClientMessage,
  type LobbyMember,
  type RoomInfo,
  type RoomSettings,
  type ServerMessage,
  type SoloSettings,
} from '../src/core/protocol';
import { AI_NAMES, PERSONALITIES, type AIDifficulty, type AIPersonality } from '../src/core/ai/ai';
import { randomAnimal, sanitizeAnimal, sanitizeName, type PlayerProfile } from '../src/core/player/profile';
import type { AccountState, ProgressEvent } from '../src/core/account/types';
import { effectiveBet, type GameFacts, type HandFacts } from '../src/progress/rewards';
import { randomId, randomRoomCode } from '../src/core/utils/random';
import { nicknameError } from '../src/core/account/types';
import { connectionLimiter } from './rateLimit';
import { MemoryHub, type SharedStore } from './store';

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
  recordBlackjack(userId: string, key: string, f: BjRoundFacts, useWallet: boolean): ProgressEvent | null;
  chipsOf(userId: string): number;
  refillChips(userId: string, below: number, amount: number): number;
}

/** 本机上的连接会话（连接只存在于接受它的那台服务器上） */
interface Session {
  sessionId: string;
  /** 已登录玩家的账号 ID（只在服务器内部使用，从不发给客户端） */
  userId: string | null;
  playerId: string;
  profile: PlayerProfile;
  conn: Connection | null;
  roomCode: string | null;
  /** 上一次发给这条连接的牌局状态（用于只发送新增事件） */
  sent?: { game: string; conn: Connection; hand: number; seq: number; profiles: Map<string, string> };
  /** 上一次发给这条连接的房间信息（没变化就不重复发送） */
  lastRoomJson?: string;
  /** 断线后的宽限计时：期间重新连接（哪怕连到另一台服务器）就不算断线 */
  offlineTimer?: ReturnType<typeof setTimeout>;
  /** 最近一次“创建房间”请求（code 为 null 表示正在创建）：同一个请求重复到达时不再创建第二个房间 */
  lastCreate?: { id: string; code: string | null };
}

/** 共享存储中的会话记录（玩家刷新页面 / 连到另一台服务器时用来恢复身份） */
interface SessionRecord {
  playerId: string;
  profile: PlayerProfile;
  userId: string | null;
  roomCode: string | null;
}

interface MemberRec extends LobbyMember {
  sessionId?: string;
  userId?: string | null;
  /** 最近处理过的动作 ID → 结果（重复发送时直接返回同样的结果，不再执行） */
  recentActions?: [string, string | null][];
  offlineSince?: number | null;
}

/** 房间的完整记录（可 JSON 序列化，保存在共享存储中） */
interface RoomRec {
  code: string;
  hostId: string;
  settings: RoomSettings;
  members: MemberRec[];
  status: RoomInfo['status'];
  game: ControllerState | null;
  /** 21 点牌桌（与 game 同一时间只会有一个） */
  bj?: BlackjackState | null;
  chat: ChatMessage[];
  emptySince: number | null;
  solo: boolean;
  soloSettings?: SoloSettings;
  /** 房间实例 ID + 场次：组成结算的唯一键，防止重复领奖 */
  instanceId: string;
  gameSeq: number;
}

type Note = { to: 'all' | string; msg: ServerMessage };

/** 服务器之间广播的事件 */
type RoomEvent =
  | { k: 'room'; code: string; v: number; room: RoomRec | null; notes: Note[]; by: string; sess: [string, string | null][] }
  | { k: 'here'; code: string; sessionId: string; by: string };

export interface RoomServerOptions {
  /** 断线玩家在大厅中保留多久（毫秒） */
  lobbyGraceMs?: number;
  /** 无人在线的房间保留多久 */
  emptyRoomMs?: number;
  /** 游戏节奏倍率（测试用） */
  pace?: number;
  turnTimeMs?: number;
  accounts?: AccountLink | null;
  /** 共享存储（默认：进程内存） */
  store?: SharedStore;
  /** 连接断开后多久才标记为“连接中断”（期间重连不打扰其他玩家） */
  disconnectGraceMs?: number;
  /** 平台限制的单条连接最长时间（例如 Vercel 免费方案 300 秒）；客户端会在到期前无缝换一条新连接 */
  maxConnectionMs?: number;
  /** 其他服务器作为备份推进牌局计时的延迟 */
  backupTickMs?: number;
}

const DIFFS: AIDifficulty[] = ['easy', 'normal', 'hard', 'expert'];
/**
 * 客户端发来的 AI 性格是否真实存在。不能用 `x in PERSONALITIES`：
 * constructor / toString / __proto__ 这些原型链上的名字也会通过，之后读取它的名字列表时让整个请求处理失败。
 */
const isPersonality = (x: unknown): x is AIPersonality => typeof x === 'string' && Object.prototype.hasOwnProperty.call(PERSONALITIES, x);
/** 游客昵称不合规时的替代名字：由玩家 ID 决定（没有 ID 时随机） */
export function fallbackName(seed?: string): string {
  if (!seed) return '玩家' + Math.floor(1000 + Math.random() * 9000);
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return '玩家' + (1000 + ((h >>> 0) % 9000));
}
const SESSION_TTL = 24 * 3600_000;
const sessKey = (id: string) => `apc:sess:${id}`;

/** 一次房间修改（可能因为冲突被重试，所以这里只修改数据、收集要发送的消息） */
class Tx {
  notes: Note[] = [];
  /** 只发给请求者、不需要等待广播的消息（例如错误提示） */
  direct: ServerMessage[] = [];
  changed = false;
  deleted = false;
  sess = new Map<string, string | null>();
  ctrl: GameController | null = null;
  bjc: BlackjackController | null = null;
  collision = false;
  /** 请求者已经不在房间里 */
  notMember = false;

  constructor(
    public room: RoomRec | null,
    private hydrate: (tx: Tx) => GameController | null,
    private hydrateBj: (tx: Tx) => BlackjackController | null,
  ) {}

  touch() {
    this.changed = true;
  }
  /** 牌局控制器（从记录中恢复，修改后自动保存回记录） */
  controller(): GameController | null {
    if (!this.ctrl) this.ctrl = this.hydrate(this);
    return this.ctrl;
  }
  /** 21 点牌桌的控制器 */
  blackjack(): BlackjackController | null {
    if (!this.bjc) this.bjc = this.hydrateBj(this);
    return this.bjc;
  }
  error(message: string) {
    this.direct.push({ t: 'error', message });
  }
  chat(partial: Omit<ChatMessage, 'id' | 'time'>) {
    if (!this.room) return;
    const message: ChatMessage = { ...partial, id: randomId(8), time: Date.now() };
    this.room.chat.push(message);
    if (this.room.chat.length > 60) this.room.chat.shift();
    this.notes.push({ to: 'all', msg: { t: 'chat', message } });
    this.touch();
  }
  system(text: string) {
    this.chat({ from: 'system', name: '系统', text, kind: 'system' });
  }
  to(sessionId: string, msg: ServerMessage) {
    this.notes.push({ to: sessionId, msg });
  }
}

export class RoomServer {
  private sessions = new Map<string, Session>();
  /** 本机缓存的房间记录（以共享存储为准） */
  private cache = new Map<string, { v: number; room: RoomRec; seen?: number }>();
  private locks = new Map<string, Promise<void>>();
  private wake = new Map<string, ReturnType<typeof setTimeout>>();
  private opts: Required<Omit<RoomServerOptions, 'accounts' | 'store' | 'maxConnectionMs'>> & { maxConnectionMs: number | null };
  private accounts: AccountLink | null;
  private store: SharedStore;
  private ownsStore: boolean;
  private sweepTimer: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(opts: RoomServerOptions = {}) {
    this.opts = {
      lobbyGraceMs: opts.lobbyGraceMs ?? 60_000,
      emptyRoomMs: opts.emptyRoomMs ?? 10 * 60_000,
      pace: opts.pace ?? 1,
      turnTimeMs: opts.turnTimeMs ?? 30_000,
      disconnectGraceMs: opts.disconnectGraceMs ?? 2500,
      maxConnectionMs: opts.maxConnectionMs ?? null,
      backupTickMs: opts.backupTickMs ?? 1500,
    };
    this.accounts = opts.accounts ?? null;
    this.ownsStore = !opts.store;
    this.store = opts.store ?? new MemoryHub().store('local-' + randomId(6));
    this.store.subscribe((e) => this.onEvent(e));
    // 订阅断线期间可能错过了房间事件：丢弃缓存，之后从共享存储读取最新数据
    this.store.onReconnect?.(() => {
      this.cache.clear();
      // 期间本机玩家可能没收到牌局更新，备份计时也可能失效：逐个房间重新同步
      const codes = new Set([...this.sessions.values()].filter((s) => s.conn && s.roomCode).map((s) => s.roomCode!));
      for (const code of codes) this.background(this.resyncLocal(code), '重新同步房间');
    });
    this.sweepTimer = setInterval(() => this.sweep(), Math.min(5000, Math.max(200, this.opts.lobbyGraceMs / 2)));
  }

  /** 服务器即将重启：通知所有在线玩家（房间只在服务器运行期间存在） */
  notifyShutdown() {
    for (const s of this.sessions.values())
      s.conn?.send({ t: 'notice', kind: 'shutdown', message: '服务器正在重启，当前房间将会失效。请稍后重新创建房间。' });
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.sweepTimer);
    for (const t of this.wake.values()) clearTimeout(t);
    for (const s of this.sessions.values()) if (s.offlineTimer) clearTimeout(s.offlineTimer);
    if (this.ownsStore) void this.store.close();
  }

  get roomCount() {
    return this.cache.size;
  }

  getRoom(code: string) {
    return this.cache.get(code)?.room;
  }

  /** 新连接：返回该连接的消息处理器与关闭回调 */
  connect(conn: Connection, ctx: { userId?: string | null } = {}) {
    let session: Session | null = null;
    const userId = ctx.userId ?? null;
    const limiter = connectionLimiter();
    // 同一条连接的消息按顺序处理（例如“创建房间”完成后才处理“添加 AI”）
    let chain: Promise<void> = Promise.resolve();
    const run = (fn: () => Promise<void>) => {
      chain = chain.then(fn).catch((err) => {
        console.error('[房间] 处理消息出错', err);
        conn.send({ t: 'error', message: '服务器处理失败，请重试' });
      });
    };
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
          if ((msg.t === 'action' || msg.t === 'bj') && typeof (msg as any).actionId === 'string')
            conn.send({ t: 'ack', actionId: String((msg as any).actionId).slice(0, 40), ok: false, message: '操作太频繁，请稍后再试' });
          else if (limiter.shouldWarn()) conn.send({ t: 'error', message: '操作太频繁，请稍后再试' });
          return;
        }
        if (msg.t === 'ping') {
          conn.send({ t: 'pong', time: msg.time, serverTime: Date.now() });
          return;
        }
        const m = msg;
        run(async () => {
          if (m.t === 'hello') {
            const prev: Session | null = session;
            const next = await this.hello(conn, m.sessionId, m.profile, userId, !!(m as any).rotate);
            session = next;
            // 同一条连接换了会话：旧会话按断线处理，否则它会一直显示“在线”，占着座位和房间
            if (prev && (prev as Session) !== next && (prev as Session).conn === conn) this.disconnect(prev);
            return;
          }
          if (!session) return conn.send({ t: 'error', message: '请先连接服务器' });
          await this.handle(session, m);
        });
      },
      onClose: () => {
        run(async () => {
          if (session && session.conn === conn) this.disconnect(session);
        });
      },
    };
  }

  // ───────────── 共享存储：读取 / 修改 / 事件 ─────────────

  /** 后台修改（定时清理、断线标记等）：出错只记录，绝不能变成未处理的 Promise 拒绝而让进程崩溃 */
  private background(p: Promise<unknown>, label: string) {
    p.catch((err) => console.error(`[房间] ${label}出错`, err));
  }

  private async getRoomRec(code: string): Promise<{ v: number; room: RoomRec } | null> {
    const c = this.cache.get(code);
    if (c) return c;
    const r = await this.store.loadRoom(code);
    if (!r) return null;
    const rec = { v: r.v, room: JSON.parse(r.json) as RoomRec };
    this.cache.set(code, rec);
    return rec;
  }

  private hydrate = (tx: Tx): GameController | null => {
    const room = tx.room;
    if (!room?.game) return null;
    const c = GameController.fromState(JSON.parse(JSON.stringify(room.game)), { autoRun: false });
    this.wire(tx, c);
    return c;
  };

  private hydrateBj = (tx: Tx): BlackjackController | null => {
    const room = tx.room;
    if (!room?.bj) return null;
    const c = BlackjackController.fromState(JSON.parse(JSON.stringify(room.bj)), { autoRun: false });
    this.wireBj(tx, c);
    return c;
  };

  /** 把 21 点控制器接到本次修改上：台词、结算、持久筹码（只有登录玩家的单人桌使用账号筹码） */
  private wireBj(tx: Tx, c: BlackjackController) {
    const room = tx.room!;
    const key = `${room.instanceId}:${room.gameSeq}`;
    const accounts = this.accounts;
    const userOf = (id: string) => (room.solo && accounts ? (room.members.find((m) => m.id === id)?.userId ?? null) : null);
    const wallet = (userId: string) => {
      try {
        // 同一账号在别的牌桌上还没结算的下注不能再押一次
        return Math.max(0, accounts!.chipsOf(userId) - this.heldElsewhere(userId, room.code));
      } catch {
        return null;
      }
    };
    c.hooks = {
      balanceOf: (id) => {
        const userId = userOf(id);
        return userId ? wallet(userId) : null;
      },
      refill: (id) => {
        const userId = userOf(id);
        if (!userId || this.heldElsewhere(userId, room.code) > 0) return null;
        try {
          return accounts!.refillChips(userId, c.engine.rules.minBet, REFILL_CHIPS);
        } catch {
          return null;
        }
      },
      onChat: (id, text, dialogue) => {
        const name = id === DEALER_ID ? c.dealer.profile.name : room.members.find((m) => m.id === id)?.profile.name;
        if (name) tx.chat({ from: id, name, text, kind: 'chat', dialogue });
      },
      onRound: (results, roundId) => this.settleBlackjack(room, results, `${key}:bj:${roundId}`),
    };
  }

  /** 这个账号在其他房间的 21 点牌桌上还没结算的下注（账号系统只在单台服务器上开启，所以本机缓存就是全部房间） */
  private heldElsewhere(userId: string, code: string): number {
    let held = 0;
    for (const [other, rec] of this.cache) {
      if (other === code || !rec.room.bj || !rec.room.solo) continue;
      const m = rec.room.members.find((x) => x.userId === userId);
      const p = m && rec.room.bj.engine.players.find((x) => x.id === m.id);
      if (!p) continue;
      held += rec.room.bj.engine.phase === 'betting' ? p.bet : rec.room.bj.engine.phase === 'round-end' ? 0 : p.hands.reduce((s, h) => s + h.bet, 0);
    }
    return held;
  }

  /** 把控制器的回调（AI 聊天、每手结算）接到本次修改上 */
  private wire(tx: Tx, c: GameController) {
    const room = tx.room!;
    const gameKey = `${room.instanceId}:${room.gameSeq}`;
    c.onChat = (playerId, kind, text, dialogue) => {
      const m = room.members.find((x) => x.id === playerId);
      if (m) tx.chat({ from: playerId, name: m.profile.name, text, kind, ...(dialogue ? { dialogue } : {}) });
    };
    c.onHandComplete = () => this.settleHand(room, c, gameKey);
  }

  /**
   * 修改房间：同一台服务器上按房间排队；与其他服务器冲突时重新读取并重试。
   * fn 必须只修改 tx（可能被执行多次）。
   */
  private async mutate(code: string, requester: Session | null, fn: (tx: Tx) => void): Promise<Tx> {
    const prev = this.locks.get(code) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => mine);
    this.locks.set(code, chained);
    await prev;
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const base = await this.getRoomRec(code);
        const tx = new Tx(base ? (JSON.parse(JSON.stringify(base.room)) as RoomRec) : null, this.hydrate, this.hydrateBj);
        fn(tx);
        if (tx.collision) return tx;
        if (tx.ctrl && tx.room && !tx.deleted) {
          // 牌局结束：标记状态并结算
          if (tx.ctrl.isGameOver() && tx.room.status === 'playing') {
            tx.room.status = 'finished';
            this.settleGame(tx.room, tx.ctrl, `${tx.room.instanceId}:${tx.room.gameSeq}`);
            tx.touch();
          }
          if (tx.changed) tx.room.game = tx.ctrl.toState();
        }
        if (tx.bjc && tx.room && !tx.deleted && tx.changed) tx.room.bj = tx.bjc.toState();
        if (!tx.changed) {
          for (const m of tx.direct) requester?.conn?.send(m);
          return tx;
        }
        const v = base?.v ?? 0;
        const next = v + 1;
        const room = tx.deleted ? null : tx.room;
        const event: RoomEvent = { k: 'room', code, v: next, room, notes: tx.notes, by: this.store.instanceId, sess: [...tx.sess] };
        const ttl = Math.max(this.opts.emptyRoomMs * 2, 30 * 60_000);
        const ok = await this.store.commitRoom(code, v, next, room ? JSON.stringify(room) : null, ttl, JSON.stringify(event));
        if (!ok) {
          // 另一台服务器刚刚修改过：丢弃缓存，用最新数据重试
          this.cache.delete(code);
          continue;
        }
        if (room) this.cache.set(code, { v: next, room });
        else this.cache.delete(code);
        // 本机的会话立即更新（不用等广播），保证同一连接的下一条消息看到新的房间
        for (const [sid, rc] of tx.sess) {
          const s = this.sessions.get(sid);
          if (s) {
            s.roomCode = rc;
            void this.saveSession(s);
          }
        }
        for (const m of tx.direct) requester?.conn?.send(m);
        return tx;
      }
      requester?.conn?.send({ t: 'error', message: '服务器繁忙，请重试' });
      return new Tx(null, this.hydrate, this.hydrateBj);
    } finally {
      release();
      if (this.locks.get(code) === chained) this.locks.delete(code);
    }
  }

  private onEvent(raw: string) {
    try {
      this.applyEvent(raw);
    } catch (err) {
      // 事件处理出错（例如数据损坏）只影响这一条事件，不能让服务器崩溃
      console.error('[房间] 处理房间事件出错', err);
    }
  }

  private applyEvent(raw: string) {
    if (this.disposed) return;
    let ev: RoomEvent;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    if (ev.k === 'here') {
      // 玩家已经在别的连接上重新连接：取消本机对旧连接的“断线”处理
      // 会话已经搬到另一台服务器：本机忘掉它，旧连接之后关闭也不算断线
      const s = this.sessions.get(ev.sessionId);
      if (s && ev.by !== this.store.instanceId) {
        if (s.offlineTimer) clearTimeout(s.offlineTimer);
        s.offlineTimer = undefined;
        this.sessions.delete(s.sessionId);
      }
      return;
    }
    const cur = this.cache.get(ev.code);
    if (!cur || cur.v <= ev.v) {
      if (ev.room) this.cache.set(ev.code, { v: ev.v, room: ev.room });
      else this.cache.delete(ev.code);
    }
    for (const [sid, rc] of ev.sess) {
      const s = this.sessions.get(sid);
      if (s) s.roomCode = rc;
    }
    const latest = this.cache.get(ev.code)?.room ?? null;
    // 发给本机上的相关连接
    const local = [...this.sessions.values()].filter((s) => s.conn && s.roomCode === ev.code);
    for (const n of ev.notes) {
      if (n.to === 'all') for (const s of local) s.conn!.send(n.msg);
      else this.sessions.get(n.to)?.conn?.send(n.msg);
    }
    if (latest) {
      const info = JSON.stringify(this.roomInfo(latest));
      let ctrl: GameController | null = null;
      let bjc: BlackjackController | null = null;
      for (const s of local) {
        if (!latest.members.some((m) => m.id === s.playerId)) continue;
        if (s.lastRoomJson !== info) {
          s.lastRoomJson = info;
          s.conn!.send({ t: 'room', room: JSON.parse(info) });
        }
        if (latest.game) {
          ctrl ??= GameController.fromState(JSON.parse(JSON.stringify(latest.game)), { autoRun: false });
          this.sendState(s, latest, ctrl, s.playerId);
        }
        if (latest.bj) {
          bjc ??= BlackjackController.fromState(JSON.parse(JSON.stringify(latest.bj)), { autoRun: false });
          this.sendBlackjack(s, latest, bjc, s.playerId);
        }
      }
    }
    this.arm(ev.code, ev.by === this.store.instanceId);
  }

  /** 为房间的下一步牌局计时设置定时器（自己刚写入的立即负责；其他服务器稍后作为备份） */
  private arm(code: string, primary: boolean) {
    const old = this.wake.get(code);
    if (old) clearTimeout(old);
    this.wake.delete(code);
    const rec = this.cache.get(code);
    const at = rec?.room.game?.pending?.at ?? rec?.room.bj?.pending?.at;
    if (!rec || at == null || rec.room.game?.gameOver) return;
    const hasLocal = [...this.sessions.values()].some((s) => s.conn && s.roomCode === code);
    if (!primary && !hasLocal) return;
    const v = rec.v;
    const delay = Math.max(0, at - Date.now()) + (primary ? 0 : this.opts.backupTickMs);
    this.wake.set(
      code,
      setTimeout(() => {
        this.wake.delete(code);
        // 期间已经被别的服务器推进过：不用再做
        if (!primary && this.cache.get(code)?.v !== v) return;
        void this.mutate(code, null, (tx) => {
          const c = tx.controller() ?? tx.blackjack();
          // 计时器可能早触发 1 毫秒：按预定时间推进
          if (c && c.tick(Math.max(Date.now(), at))) tx.touch();
        })
          .then((tx) => {
            // 没有推进（例如数据已被别处更新）：按最新状态重新设置定时器
            if (!tx.changed) this.arm(code, primary);
          })
          .catch((err) => {
            console.error('[房间] 推进牌局出错', err);
            // 存储暂时不可用：稍后再试，不能让这一桌永远停住
            if (this.disposed || this.wake.has(code)) return;
            this.wake.set(code, setTimeout(() => (this.wake.delete(code), this.arm(code, primary)), 1000));
          });
      }, delay),
    );
  }

  /** 可能错过了事件：从共享存储读取最新房间，完整地发给本机上的玩家，并重新设置计时 */
  private async resyncLocal(code: string) {
    const room = (await this.getRoomRec(code))?.room ?? null;
    for (const s of [...this.sessions.values()]) {
      if (s.roomCode !== code || !s.conn) continue;
      if (!room || !room.members.some((m) => m.id === s.playerId)) {
        s.roomCode = null;
        s.lastRoomJson = undefined;
        s.conn.send({ t: 'room', room: null });
        continue;
      }
      await this.resendRoom(s);
      this.sendTable(s, room);
    }
    this.arm(code, false);
  }

  private async saveSession(s: Session) {
    const rec: SessionRecord = { playerId: s.playerId, profile: s.profile, userId: s.userId, roomCode: s.roomCode };
    try {
      await this.store.set(sessKey(s.sessionId), JSON.stringify(rec), SESSION_TTL);
    } catch (err) {
      console.error('[房间] 保存会话失败', err);
    }
  }

  // ───────────── 会话 ─────────────

  private async hello(conn: Connection, sessionId: string | undefined, profileIn: any, userId: string | null, rotate: boolean): Promise<Session> {
    const validId = typeof sessionId === 'string' && /^[A-Za-z0-9]{8,64}$/.test(sessionId);
    let s = validId ? this.sessions.get(sessionId!) : undefined;
    if (!s && validId) {
      // 可能是刷新页面，或者上一条连接在另一台服务器上
      try {
        const raw = await this.store.get(sessKey(sessionId!));
        if (raw) {
          const rec = JSON.parse(raw) as SessionRecord;
          s = { sessionId: sessionId!, userId: rec.userId, playerId: rec.playerId, profile: rec.profile, conn: null, roomCode: rec.roomCode };
          this.sessions.set(s.sessionId, s);
        }
      } catch {
        /* 读取失败：当作新会话 */
      }
    }
    // 会话属于另一个账号（或账号已退出）时不能复用，防止冒用他人的座位
    if (s && s.userId && s.userId !== userId) s = undefined;
    const resumed = !!s;
    // 登录玩家：昵称、动物、等级、头像全部来自服务器数据库，忽略客户端发来的资料。
    // 先确定玩家 ID：游客昵称不合规时的替代名字由它决定，刷新 / 重连后保持不变
    const playerId = s?.playerId ?? 'u_' + randomId(10);
    const profile = this.profileFor(userId, profileIn, playerId);
    if (s) {
      s.userId = userId;
      if (s.offlineTimer) {
        clearTimeout(s.offlineTimer);
        s.offlineTimer = undefined;
      }
      // 同一会话的旧连接：无缝换连接时静默关闭，否则通知旧连接“已被替换”
      if (s.conn && s.conn !== conn) {
        try {
          // 告诉旧连接“被替换了”：客户端据此停止自动重连，否则两个页面会互相挤掉、无限重连
          if (!rotate) s.conn.send({ t: 'notice', kind: 'replaced', message: '这个座位已在另一个标签页或页面上打开，本页面已断开。' });
          s.conn.close?.();
        } catch {
          /* ignore */
        }
      }
      s.conn = conn;
      s.profile = profile;
      s.sent = undefined;
      s.lastRoomJson = undefined;
    } else {
      s = { sessionId: randomId(24), userId, playerId, profile, conn, roomCode: null };
      this.sessions.set(s.sessionId, s);
      void this.saveSession(s);
    }
    const session = s;
    conn.send({
      t: 'welcome',
      sessionId: session.sessionId,
      playerId: session.playerId,
      resumed,
      protocol: PROTOCOL_VERSION,
      ...(this.opts.maxConnectionMs ? { rotateInMs: this.opts.maxConnectionMs } : {}),
    });
    if (userId && this.accounts) {
      try {
        conn.send({ t: 'account', state: this.accounts.getState(userId) });
      } catch {
        /* 账号读取失败不影响进入房间 */
      }
    }

    const code = session.roomCode;
    const rec = code ? await this.getRoomRec(code) : null;
    const member = rec?.room.members.find((m) => m.id === session.playerId);
    if (!code || !rec || !member) {
      if (code) {
        session.roomCode = null;
        void this.saveSession(session);
      }
      conn.send({ t: 'room', room: null });
      return session;
    }
    // 告诉其他服务器：这名玩家已经重新连上（取消它们的“断线”处理）
    if (resumed) this.background(this.store.publish(JSON.stringify({ k: 'here', code, sessionId: session.sessionId, by: this.store.instanceId } satisfies RoomEvent)), '发送重新连接通知');
    const needsUpdate = !member.connected || member.userId !== userId || (rec.room.status === 'lobby' && JSON.stringify(member.profile) !== JSON.stringify(profile));
    if (needsUpdate) {
      await this.mutate(code, session, (tx) => {
        const room = tx.room;
        const m = room?.members.find((x) => x.id === session.playerId);
        if (!room || !m) return;
        const wasOffline = !m.connected;
        m.connected = true;
        m.offlineSince = null;
        m.userId = userId;
        if (room.status === 'lobby') m.profile = profile;
        room.emptySince = null;
        (tx.controller() ?? tx.blackjack())?.setConnected(m.id, true);
        if (wasOffline) tx.system(`${m.profile.name} 重新连接了`);
        tx.touch();
      });
    }
    const latest = (await this.getRoomRec(code))?.room;
    if (!latest || !latest.members.some((m) => m.id === session.playerId)) {
      conn.send({ t: 'room', room: null });
      return session;
    }
    conn.send({ t: 'chatHistory', messages: latest.chat });
    const info = this.roomInfo(latest);
    session.lastRoomJson = JSON.stringify(info);
    conn.send({ t: 'room', room: info });
    this.sendTable(session, latest);
    this.arm(code, false);
    return session;
  }

  private disconnect(s: Session) {
    s.conn = null;
    // 这个会话已经在别的连接上（本机或另一台服务器）继续：不是断线
    if (this.sessions.get(s.sessionId) !== s) return;
    const code = s.roomCode;
    if (!code) {
      this.sessions.delete(s.sessionId);
      return;
    }
    // 短暂宽限：网络抖动、刷新页面、换连接时不打扰其他玩家
    if (s.offlineTimer) clearTimeout(s.offlineTimer);
    s.offlineTimer = setTimeout(() => {
      s.offlineTimer = undefined;
      if (s.conn || this.disposed) return;
      this.sessions.delete(s.sessionId);
      void this.mutate(code, null, (tx) => {
        const room = tx.room;
        const m = room?.members.find((x) => x.id === s.playerId);
        if (!room || !m || !m.connected) return;
        m.connected = false;
        m.offlineSince = Date.now();
        (tx.controller() ?? tx.blackjack())?.setConnected(m.id, false);
        tx.system(`${m.profile.name} 断线了`);
        if (!room.members.some((x) => !x.isAI && x.connected)) room.emptySince = Date.now();
        tx.touch();
      }).catch((err) => console.error('[房间] 标记断线出错', err));
    }, this.opts.disconnectGraceMs);
  }

  private sweep() {
    const now = Date.now();
    for (const [code, rec] of this.cache) {
      const room = rec.room;
      // 本机没有玩家、也很久没有变化的房间：从缓存中移除（以共享存储为准，需要时再读取）
      const seen = rec.seen ?? (rec.seen = now);
      if (now - seen > 30 * 60_000 && ![...this.sessions.values()].some((s) => s.roomCode === code) && !this.wake.has(code)) {
        this.cache.delete(code);
        continue;
      }
      if (room.emptySince && now - room.emptySince > this.opts.emptyRoomMs) {
        this.background(this.mutate(code, null, (tx) => {
          if (tx.room?.emptySince && Date.now() - tx.room.emptySince > this.opts.emptyRoomMs) {
            tx.deleted = true;
            tx.touch();
          }
        }), '清理房间');
        continue;
      }
      // 比赛结束后房主一直不在线：只有房主能带大家回房间大厅，所以把房主交给还在线的玩家
      const hostAway = (r: RoomRec) => {
        const h = r.members.find((m) => m.id === r.hostId);
        // 21 点没有“比赛结束”：一直在打的牌桌上房主长时间不在线也要交接
        if ((r.status !== 'finished' && !(r.status === 'playing' && r.bj)) || !h || h.connected || !h.offlineSince || Date.now() - h.offlineSince <= this.opts.lobbyGraceMs) return null;
        return r.members.find((m) => !m.isAI && m.connected) ?? null;
      };
      if (hostAway(room)) {
        this.background(this.mutate(code, null, (tx) => {
          const next = tx.room && hostAway(tx.room);
          if (!next) return;
          tx.room!.hostId = next.id;
          tx.system(`${next.profile.name} 成为了新房主`);
        }), '转交房主');
        continue;
      }
      if (room.status === 'lobby' && room.members.some((m) => !m.isAI && !m.connected && m.offlineSince && now - m.offlineSince > this.opts.lobbyGraceMs)) {
        this.background(this.mutate(code, null, (tx) => {
          if (!tx.room || tx.room.status !== 'lobby') return;
          for (const m of [...tx.room.members]) {
            if (m.isAI || m.connected || !m.offlineSince || Date.now() - m.offlineSince <= this.opts.lobbyGraceMs) continue;
            this.removeMember(tx, m.id, '长时间离线，已移出房间');
            if (tx.deleted) break;
          }
        }), '清理房间');
      }
    }
  }

  /** seed：玩家 ID。游客昵称不合规时用它生成固定的替代名字（同一名玩家每次重连都一样，不会一会儿一个名字） */
  private profileFor(userId: string | null, p: any, seed?: string): PlayerProfile {
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
    if (nicknameError(clean.name)) clean.name = fallbackName(seed);
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

  private async handle(s: Session, msg: ClientMessage) {
    const err = (message: string) => s.conn?.send({ t: 'error', message });
    switch (msg.t) {
      case 'createRoom': {
        const settings = this.cleanSettings(msg.settings);
        if (!settings) return err('房间设置无效');
        const rid = typeof msg.requestId === 'string' && msg.requestId ? msg.requestId.slice(0, 40) : null;
        if (rid && s.lastCreate?.id === rid) {
          // 同一个创建请求重复到达（连续点击、断线后重发）：不创建第二个房间；
          // 仍在那个房间里就把房间信息再发一次，让客户端进入房间
          if (s.lastCreate.code && s.roomCode === s.lastCreate.code) await this.resendRoom(s);
          return;
        }
        if (rid) s.lastCreate = { id: rid, code: null };
        if (s.roomCode) await this.leave(s);
        await this.createRoom(s, settings, null);
        if (rid && s.lastCreate?.id === rid) s.lastCreate.code = s.roomCode;
        return;
      }
      case 'startSolo': {
        const solo = this.cleanSolo(msg.settings);
        if (!solo) return err('对局设置无效');
        if (s.roomCode) await this.leave(s);
        await this.createRoom(
          s,
          { gameMode: solo.blackjack ? 'blackjack-21' : 'texas-holdem', maxPlayers: solo.opponents.length + 1, startingChips: solo.startingChips, smallBlind: solo.smallBlind, bigBlind: solo.bigBlind, turnSeconds: 45 },
          solo,
        );
        return;
      }
      case 'joinRoom': {
        const code = String(typeof msg.code === 'string' ? msg.code : '').trim().toUpperCase();
        if (!/^[A-Z0-9]{4,8}$/.test(code)) return err('房间不存在，请检查房间代码');
        const target = await this.getRoomRec(code);
        if (!target || (target.room.solo && !target.room.members.some((m) => m.id === s.playerId))) return err('房间不存在，请检查房间代码');
        // 先确认进得去再离开现在的房间：目标房间已满 / 已开始时，不能让玩家连原来的座位也丢了
        if (!target.room.members.some((m) => m.id === s.playerId)) {
          if (target.room.status !== 'lobby') return err('游戏已经开始，暂时无法加入');
          if (target.room.members.length >= target.room.settings.maxPlayers) return err('房间已满');
        }
        if (s.roomCode && s.roomCode !== code) await this.leave(s);
        // 必须在修改之前清空：房间事件可能比 mutate 返回得更早处理，之后再清空就会漏发房间信息
        s.lastRoomJson = undefined;
        s.sent = undefined;
        await this.mutate(code, s, (tx) => {
          const room = tx.room;
          if (!room) return tx.error('房间不存在，请检查房间代码');
          const existing = room.members.find((m) => m.id === s.playerId);
          if (existing) {
            // 已经在房间里（重复加入）：只恢复连接，不会出现两个相同的玩家
            existing.connected = true;
            existing.offlineSince = null;
            existing.sessionId = s.sessionId;
            tx.sess.set(s.sessionId, code);
            tx.to(s.sessionId, { t: 'chatHistory', messages: room.chat });
            tx.touch();
            return;
          }
          if (room.status !== 'lobby') return tx.error('游戏已经开始，暂时无法加入');
          if (room.members.length >= room.settings.maxPlayers) return tx.error('房间已满');
          this.addHuman(tx, s);
          tx.system(`${s.profile.name} 加入了房间`);
          tx.to(s.sessionId, { t: 'chatHistory', messages: room.chat });
        });
        return;
      }
      case 'leaveRoom':
        if (s.roomCode) await this.leave(s);
        s.lastRoomJson = undefined;
        s.conn?.send({ t: 'room', room: null });
        return;
    }

    const code = s.roomCode;
    if (!code) {
      if ((msg.t === 'action' || msg.t === 'bj') && typeof msg.actionId === 'string') s.conn?.send({ t: 'ack', actionId: msg.actionId.slice(0, 40), ok: false, message: '当前没有进行中的游戏' });
      else if (['ready', 'chat', 'emote', 'resync', 'pause'].includes(msg.t)) return;
      else if (msg.t === 'updateProfile') s.profile = this.profileFor(s.userId, msg.profile, s.playerId);
      else err('你不在任何房间中');
      return;
    }

    switch (msg.t) {
      case 'resync': {
        const rec = await this.getRoomRec(code);
        if (rec) this.sendTable(s, rec.room);
        return;
      }
      case 'updateProfile':
        s.profile = this.profileFor(s.userId, msg.profile, s.playerId);
        void this.saveSession(s);
        await this.mutate(code, s, (tx) => {
          const m = tx.room?.members.find((x) => x.id === s.playerId);
          if (tx.room?.status === 'lobby' && m && JSON.stringify(m.profile) !== JSON.stringify(s.profile)) {
            m.profile = s.profile;
            tx.touch();
          }
        });
        return;
    }

    const result = await this.mutate(code, s, (tx) => {
      const room = tx.room;
      const me = room?.members.find((m) => m.id === s.playerId);
      const isHost = !!room && room.hostId === s.playerId;
      if (!room || !me) {
        // 已经不在这个房间（被移出 / 房间已关闭）：告诉客户端，并清掉本机记录
        if ((msg.t === 'action' || msg.t === 'bj') && typeof msg.actionId === 'string') tx.direct.push({ t: 'ack', actionId: msg.actionId.slice(0, 40), ok: false, message: '当前没有进行中的游戏' });
        tx.direct.push({ t: 'room', room: null });
        tx.notMember = true;
        return;
      }
      switch (msg.t) {
        case 'ready':
          if (room.status !== 'lobby') return;
          if (me.ready !== !!msg.ready) {
            me.ready = !!msg.ready;
            tx.touch();
          }
          return;
        case 'addAI': {
          if (!isHost) return tx.error('只有房主可以添加 AI');
          if (room.status !== 'lobby') return tx.error('游戏进行中无法添加 AI');
          if (room.members.length >= room.settings.maxPlayers) return tx.error('房间已满');
          const { name, personality } = this.pushAI(room, msg.personality, msg.difficulty);
          tx.system(`${name}（${PERSONALITIES[personality].name} · AI）加入了牌桌`);
          return;
        }
        case 'removeMember': {
          if (!isHost) return tx.error('只有房主可以移除玩家');
          if (room.status !== 'lobby') return tx.error('游戏进行中无法移除玩家');
          if (msg.id === s.playerId) return;
          const target = room.members.find((m) => m.id === msg.id);
          if (!target) return;
          this.removeMember(tx, target.id, target.isAI ? '已被移出牌桌' : '已被房主移出房间');
          return;
        }
        case 'startGame': {
          // 只有房主可以开始：服务器根据房间记录判断，客户端无法伪造
          if (!isHost) return tx.error('只有房主可以开始游戏');
          if (room.status === 'playing') return tx.error('游戏已经开始');
          const mode = GAME_MODES[gameModeOf(room.settings)];
          if (room.members.length < mode.minPlayers) return tx.error(`至少需要 ${mode.minPlayers} 名玩家（可以添加 AI）`);
          const notReady = room.members.filter((m) => !m.isAI && !m.ready && m.id !== room.hostId);
          if (notReady.length) return tx.error(`还有玩家没有准备：${notReady.map((m) => m.profile.name).join('、')}`);
          this.startGame(tx);
          return;
        }
        case 'setMode': {
          if (!isHost) return tx.error('只有房主可以切换游戏模式');
          if (room.status !== 'lobby' || room.solo) return tx.error('牌局进行中不能切换游戏模式');
          if (!isGameMode(msg.gameMode)) return tx.error('没有这个游戏模式');
          if (gameModeOf(room.settings) === msg.gameMode) return;
          room.settings.gameMode = msg.gameMode;
          // 换了玩法：请大家重新确认准备
          for (const m of room.members) if (!m.isAI) m.ready = false;
          tx.system(`房主把游戏模式切换为「${GAME_MODES[msg.gameMode].name}」`);
          return;
        }
        case 'bj': {
          const actionId = typeof msg.actionId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(msg.actionId) ? msg.actionId : null;
          const reply = (message: string | null, duplicate = false) => {
            const ack: ServerMessage | null = actionId ? { t: 'ack', actionId, ok: !message, ...(message ? { message } : {}), ...(duplicate ? { duplicate } : {}) } : null;
            if (!ack) {
              if (message) tx.error(message);
            } else if (!message && !duplicate) tx.to(s.sessionId, ack);
            else tx.direct.push(ack);
          };
          const c = tx.blackjack();
          if (!c) return reply('当前没有进行中的牌局');
          const seen = me.recentActions?.find(([id]) => id === actionId);
          if (actionId && seen) return reply(seen[1], true);
          const cmd = msg.cmd;
          const result =
            !cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string'
              ? '无效操作'
              : c.handle(me.id, cmd.type === 'bet' ? { type: 'bet', amount: cmd.amount } : { type: cmd.type }, {
                  round: typeof msg.round === 'number' ? msg.round : undefined,
                  token: typeof msg.token === 'number' ? msg.token : undefined,
                });
          if (actionId) {
            me.recentActions = [...(me.recentActions ?? []), [actionId, result] as [string, string | null]].slice(-30);
            tx.touch();
          }
          if (!result) tx.touch();
          reply(result);
          return;
        }
        case 'action': {
          const actionId = typeof msg.actionId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(msg.actionId) ? msg.actionId : null;
          const reply = (message: string | null, duplicate = false) => {
            const ack: ServerMessage | null = actionId ? { t: 'ack', actionId, ok: !message, ...(message ? { message } : {}), ...(duplicate ? { duplicate } : {}) } : null;
            if (!ack) {
              if (message) tx.error(message);
            } else if (!message && !duplicate) tx.to(s.sessionId, ack); // 成功：随状态广播一起送达
            else tx.direct.push(ack);
          };
          const c = tx.controller();
          if (!c) return reply('当前没有进行中的游戏');
          // 重复发送同一个动作：返回第一次的结果，不再执行
          const seen = me.recentActions?.find(([id]) => id === actionId);
          if (actionId && seen) return reply(seen[1], true);
          const a = msg.action;
          let result: string | null;
          if (!a || !['fold', 'check', 'call', 'raise', 'allin'].includes(a.type)) result = '无效操作';
          else if (typeof msg.hand === 'number' && msg.hand !== c.engine.handNumber) result = '这一手牌已经结束';
          else
            result = c.handleAction(me.id, {
              type: a.type,
              amount: typeof a.amount === 'number' && isFinite(a.amount) ? Math.floor(a.amount) : undefined,
            });
          if (actionId) {
            me.recentActions = [...(me.recentActions ?? []), [actionId, result] as [string, string | null]].slice(-30);
            tx.touch();
          }
          if (!result) tx.touch();
          reply(result);
          return;
        }
        case 'chat': {
          const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);
          if (!text) return;
          tx.chat({ from: me.id, name: me.profile.name, text, kind: 'chat' });
          return;
        }
        case 'emote': {
          if (!EMOTES.includes(msg.emoji)) return;
          tx.chat({ from: me.id, name: me.profile.name, text: msg.emoji, kind: 'emote' });
          return;
        }
        case 'restartSolo': {
          if (!room.solo || !isHost || room.bj) return tx.error('当前不是单人对局');
          const c = tx.controller();
          if (room.status === 'playing' && !c?.isGameOver()) return tx.error('游戏仍在进行中');
          for (const m of room.members) m.chips = room.settings.startingChips;
          this.startGame(tx);
          return;
        }
        case 'pause': {
          // 只有单人对局可以暂停（例如查看新手教程），多人房间不允许
          const c = tx.controller();
          if (!room.solo || !c || !isHost) return;
          c.paused = !!msg.paused;
          tx.touch();
          return;
        }
        case 'backToLobby': {
          if (!isHost) return tx.error('只有房主可以返回大厅');
          const c = tx.controller();
          const bjc = tx.blackjack();
          if (bjc ? !bjc.betweenRounds() : room.status === 'playing' && !c?.isGameOver()) return tx.error(bjc ? '这一局结束后才能返回大厅' : '游戏仍在进行中');
          tx.ctrl = null;
          tx.bjc = null;
          room.game = null;
          room.bj = null;
          room.status = 'lobby';
          for (const m of room.members.filter((x) => !x.isAI && !x.connected)) if (m.sessionId) tx.sess.set(m.sessionId, null);
          room.members = room.members.filter((m) => m.isAI || m.connected);
          for (const m of room.members) {
            m.ready = m.isAI;
            m.chips = room.settings.startingChips;
            m.recentActions = undefined;
          }
          tx.system('房主将大家带回了大厅');
          return;
        }
      }
    });
    if (result.notMember && s.roomCode === code) {
      s.roomCode = null;
      s.lastRoomJson = undefined;
      void this.saveSession(s);
    }
  }

  /** 把当前房间信息（与聊天记录）重新发给这名玩家 */
  private async resendRoom(s: Session) {
    const code = s.roomCode;
    const room = code ? (await this.getRoomRec(code))?.room : null;
    if (!room || !room.members.some((m) => m.id === s.playerId)) return;
    const info = this.roomInfo(room);
    s.lastRoomJson = JSON.stringify(info);
    s.conn?.send({ t: 'chatHistory', messages: room.chat });
    s.conn?.send({ t: 'room', room: info });
  }

  /** 服务器生成房间代码；与已有房间重复时重新生成 */
  private async createRoom(s: Session, settings: RoomSettings, solo: SoloSettings | null) {
    s.lastRoomJson = undefined;
    s.sent = undefined;
    for (let i = 0; i < 20; i++) {
      const code = randomRoomCode();
      const tx = await this.mutate(code, s, (t) => {
        if (t.room) {
          t.collision = true;
          return;
        }
        const room: RoomRec = {
          code,
          hostId: s.playerId,
          settings,
          members: [],
          status: 'lobby',
          game: null,
          chat: [],
          emptySince: null,
          solo: !!solo,
          ...(solo ? { soloSettings: solo } : {}),
          instanceId: randomId(12),
          gameSeq: 0,
        };
        t.room = room;
        this.addHuman(t, s);
        if (solo) {
          for (const o of solo.opponents) this.pushAI(room, o.personality, o.difficulty, o.character);
          t.system(solo.blackjack ? `欢迎来到 21 点牌桌！${tierById(solo.blackjack.tier).name}，祝你好运 🍀` : `欢迎来到动物扑克俱乐部！本局盲注 ${solo.smallBlind}/${solo.bigBlind}，祝你好运 🍀`);
          t.to(s.sessionId, { t: 'chatHistory', messages: room.chat });
          this.startGame(t);
        } else {
          t.system(`房间 ${code} 已创建，把房间代码发给朋友吧！`);
          t.to(s.sessionId, { t: 'chatHistory', messages: room.chat });
        }
      });
      if (!tx.collision) return;
    }
    s.conn?.send({ t: 'error', message: '暂时无法创建房间，请重试' });
  }

  private cleanSettings(s: any): RoomSettings | null {
    if (!s) return null;
    const maxPlayers = Math.floor(Number(s.maxPlayers));
    if (!(maxPlayers >= 2 && maxPlayers <= MAX_ROOM_PLAYERS)) return null;
    const startingChips = CHIP_OPTIONS.includes(Number(s.startingChips)) ? Number(s.startingChips) : 1000;
    const blinds = BLIND_OPTIONS.find(([sb, bb]) => sb === Number(s.smallBlind) && bb === Number(s.bigBlind)) ?? BLIND_OPTIONS[0];
    const turnSeconds = [15, 20, 30, 45, 60].includes(Number(s.turnSeconds)) ? Number(s.turnSeconds) : 30;
    return { gameMode: gameModeOf(s), maxPlayers, startingChips, smallBlind: blinds[0], bigBlind: blinds[1], turnSeconds };
  }

  private cleanSolo(x: any): SoloSettings | null {
    // 21 点是玩家对庄家：可以没有同桌
    const bj = x?.blackjack && typeof x.blackjack === 'object' ? { dealer: isDealerChoice(x.blackjack.dealer) ? x.blackjack.dealer : ('auto' as const), tier: tierById(x.blackjack.tier).id } : null;
    if (!x || !Array.isArray(x.opponents) || x.opponents.length < (bj ? 0 : 1) || x.opponents.length > (bj ? 3 : 7)) return null;
    const startingChips = Number(x.startingChips);
    if (!CHIP_OPTIONS.includes(startingChips)) return null;
    const blinds = BLIND_OPTIONS.find(([sb, bb]) => sb === Number(x.smallBlind) && bb === Number(x.bigBlind));
    if (!blinds) return null;
    const opponents = x.opponents.map((o: any) => ({
      personality: isPersonality(o?.personality) ? o.personality : 'smartCat',
      difficulty: (DIFFS.includes(o?.difficulty) ? o.difficulty : 'easy') as AIDifficulty,
      // 玩家保存的角色：名字与外观都在服务器端重新校验
      ...(o?.character && typeof o.character === 'object' ? { character: { name: this.profileFor(null, { name: o.character.name }).name, animal: sanitizeAnimal(o.character.animal) } } : {}),
    }));
    return { opponents, startingChips, smallBlind: blinds[0], bigBlind: blinds[1], ...(bj ? { blackjack: bj } : {}) };
  }

  private pushAI(room: RoomRec, p: any, d: any, character?: { name: string; animal: PlayerProfile['animal'] }) {
    const personality: AIPersonality = isPersonality(p) ? p : 'smartCat';
    const difficulty: AIDifficulty = DIFFS.includes(d) ? d : 'normal';
    const used = new Set(room.members.map((m) => m.profile.name));
    let name = character?.name ?? AI_NAMES[personality].find((n) => !used.has(n)) ?? PERSONALITIES[personality].name + room.members.length;
    if (used.has(name)) name = name + room.members.length;
    const animal = character?.animal ?? randomAnimal(Math.random, [PERSONALITIES[personality].species]);
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

  private addHuman(tx: Tx, s: Session) {
    const room = tx.room!;
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
    room.emptySince = null;
    tx.sess.set(s.sessionId, room.code);
    tx.touch();
  }

  private async leave(s: Session) {
    const code = s.roomCode;
    if (!code) return;
    await this.mutate(code, s, (tx) => {
      tx.sess.set(s.sessionId, null);
      if (tx.room?.members.some((m) => m.id === s.playerId)) this.removeMember(tx, s.playerId, '离开了房间', true);
      else tx.touch();
    });
    s.roomCode = null;
    s.lastRoomJson = undefined;
  }

  private removeMember(tx: Tx, id: string, reason: string, self = false) {
    const room = tx.room;
    if (!room) return;
    const m = room.members.find((x) => x.id === id);
    if (!m) return;
    if (room.status === 'playing') {
      // 21 点一局中途离开：下注按输掉结算（必须在离开前算好；房间可能随后就被删除）
      const facts = tx.blackjack()?.forfeitFacts(id);
      if (facts && m.userId) this.settleBlackjack(room, [{ playerId: id, facts }], `${room.instanceId}:${room.gameSeq}:bj:${facts.roundId}`);
      (tx.controller() ?? tx.blackjack())?.removePlayer(id);
    }
    room.members = room.members.filter((x) => x.id !== id);
    if (m.sessionId) {
      tx.sess.set(m.sessionId, null);
      if (!self) tx.to(m.sessionId, { t: 'room', room: null });
    }
    tx.touch();
    const humans = room.members.filter((x) => !x.isAI);
    if (humans.length === 0) {
      // 没有真人玩家了：删除房间（释放服务器资源）
      tx.deleted = true;
      return;
    }
    // 剩下的真人都不在线：开始计算空房间的保留时间（否则这个房间没有人会清理）
    if (!humans.some((x) => x.connected)) room.emptySince ??= Date.now();
    tx.system(`${m.profile.name} ${reason}`);
    if (room.hostId === id) {
      const next = humans.find((x) => x.connected) ?? humans[0];
      room.hostId = next.id;
      tx.system(`${next.profile.name} 成为了新房主`);
    }
  }

  private startGame(tx: Tx) {
    const room = tx.room!;
    room.gameSeq++;
    if (gameModeOf(room.settings) === 'blackjack-21') return this.startBlackjack(tx);
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
      autoRun: false,
    });
    for (const m of room.members) {
      m.recentActions = undefined;
      if (!m.isAI && !m.connected) c.setConnected(m.id, false);
    }
    room.status = 'playing';
    room.bj = null;
    tx.bjc = null;
    tx.ctrl = c;
    this.wire(tx, c);
    if (!room.solo) tx.system('游戏开始！祝大家好运 🍀');
    c.start();
    tx.touch();
  }

  /** 开一桌 21 点：牌靴、洗牌、下注、庄家、结算全部在服务器；客户端只负责显示 */
  private startBlackjack(tx: Tx) {
    const room = tx.room!;
    const solo = room.solo ? room.soloSettings?.blackjack : undefined;
    const tier = solo ? tierById(solo.tier) : null;
    const wallet = !!solo && !!this.accounts;
    const c = new BlackjackController(
      room.members.map((m) => ({ id: m.id, profile: m.profile, chips: m.isAI && tier ? tier.minBet * 40 : room.settings.startingChips, isAI: m.isAI, aiPersonality: m.aiPersonality })),
      {
        solo: !!solo,
        economy: wallet ? 'profile' : 'table',
        startingChips: tier ? tier.minBet * 40 : room.settings.startingChips,
        // 多人房间：最低下注 = 房间的大盲，最高 = 起始筹码（与德州房间共用同一套设置）
        rules: tier ? { minBet: tier.minBet, maxBet: tier.maxBet } : { minBet: room.settings.bigBlind, maxBet: room.settings.startingChips },
        turnTimeMs: solo ? 0 : this.opts.turnTimeMs === 30_000 ? room.settings.turnSeconds * 1000 : this.opts.turnTimeMs,
        ...(this.opts.turnTimeMs === 30_000 ? {} : { betTimeMs: this.opts.turnTimeMs, offlineTurnMs: this.opts.turnTimeMs }),
        pace: this.opts.pace,
        dealer: pickDealer(solo?.dealer ?? 'auto', Math.random),
        autoRun: false,
      },
    );
    for (const m of room.members) {
      m.recentActions = undefined;
      if (!m.isAI && !m.connected) c.setConnected(m.id, false);
    }
    room.status = 'playing';
    room.game = null;
    tx.ctrl = null;
    tx.bjc = c;
    this.wireBj(tx, c);
    for (const m of room.members) {
      const chips = m.isAI ? null : c.hooks.balanceOf?.(m.id);
      if (typeof chips === 'number') c.engine.setBalance(m.id, chips);
    }
    if (!room.solo) tx.system('21 点开始！祝大家好运 🍀');
    c.start();
    tx.touch();
  }

  // ───────────── 结算（交给账号系统） ─────────────

  /** 一局 21 点结算：每名登录玩家每局恰好一次（key 唯一，重试 / 重放不会重复发） */
  private settleBlackjack(room: RoomRec, results: { playerId: string; facts: BjRoundFacts }[], key: string) {
    if (!this.accounts) return;
    for (const r of results) {
      const m = room.members.find((x) => x.id === r.playerId);
      if (!m || m.isAI || !m.userId) continue;
      try {
        const ev = this.accounts.recordBlackjack(m.userId, key, r.facts, room.solo);
        if (ev) this.pushProgress(m.userId, ev);
      } catch (err) {
        console.error('[结算] 保存 21 点结果失败', err);
      }
    }
  }

  private settleHand(room: RoomRec, c: GameController, gameKey: string) {
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

  private settleGame(room: RoomRec, c: GameController, gameKey: string) {
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
    for (const [code, rec] of this.cache) {
      if (!rec.room.members.some((m) => m.userId === userId)) continue;
      this.background(this.mutate(code, null, (tx) => {
        for (const m of tx.room?.members ?? []) if (m.userId === userId) (m.userId = null), tx.touch();
      }), '解除账号绑定');
    }
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
      const code = s.roomCode;
      if (!code) continue;
      this.background(this.mutate(code, null, (tx) => {
        const m = tx.room?.members.find((x) => x.id === s.playerId);
        if (tx.room?.status === 'lobby' && m) {
          m.profile = profile;
          tx.touch();
        }
      }), '解除账号绑定');
    }
  }

  // ───────────── 发送给客户端 ─────────────

  roomInfo(room: RoomRec): RoomInfo {
    const chipsMap = new Map(room.game?.engine.players.map((p) => [p.id, p.chips]) ?? room.bj?.engine.players.map((p) => [p.id, p.balance]) ?? []);
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

  /** 完整地发送当前牌桌（重新连接 / 请求同步） */
  private sendTable(s: Session, room: RoomRec) {
    if (room.game) this.sendState(s, room, GameController.fromState(JSON.parse(JSON.stringify(room.game)), { autoRun: false }), s.playerId, true);
    else if (room.bj) this.sendBlackjack(s, room, BlackjackController.fromState(JSON.parse(JSON.stringify(room.bj)), { autoRun: false }), s.playerId, true);
  }

  /** 发送 21 点视图：暗牌翻开之前不含它的任何信息；同一局只附带新增事件与变化的外观 */
  private sendBlackjack(s: Session, room: RoomRec, c: BlackjackController, id: string, full = false) {
    if (!s.conn) return;
    const view = c.getView(id);
    const game = `${room.instanceId}:${room.gameSeq}`;
    const lastSeq = view.events.length ? view.events[view.events.length - 1].seq : (s.sent?.seq ?? 0);
    const firstSeq = view.events[0]?.seq ?? 0;
    const prev = s.sent;
    const profiles = new Map(view.players.map((p) => [p.id, JSON.stringify(p.profile)]));
    let out: BlackjackView = view;
    if (!full && prev && prev.game === game && prev.conn === s.conn && prev.hand === view.round && prev.seq >= firstSeq - 1) {
      out = {
        ...view,
        events: view.events.filter((e) => e.seq > prev.seq),
        players: view.players.map((p) => (prev.profiles.get(p.id) === profiles.get(p.id) ? ({ ...p, profile: undefined } as unknown as typeof p) : p)),
        eventsDelta: true,
      };
    }
    s.sent = { game, conn: s.conn, hand: view.round, seq: lastSeq, profiles };
    s.conn.send({ t: 'bjState', view: out });
  }

  /**
   * 发送某位玩家的牌局视图（只含他自己的底牌）。同一手牌内只附带新增的事件，
   * 不重复发送整手牌的事件记录；也从不发送镜头、动画或 3D 数据。
   */
  private sendState(s: Session, room: RoomRec, c: GameController, id: string, full = false) {
    if (!s.conn) return;
    const view = c.getView(id);
    const game = `${room.instanceId}:${room.gameSeq}`;
    const lastSeq = view.events.length ? view.events[view.events.length - 1].seq : (s.sent?.seq ?? 0);
    const firstSeq = view.events[0]?.seq ?? 0;
    const prev = s.sent;
    const profiles = new Map(view.players.map((p) => [p.id, JSON.stringify(p.profile)]));
    let out: TableView = view;
    if (!full && prev && prev.game === game && prev.conn === s.conn && prev.hand === view.handNumber && prev.seq >= firstSeq - 1) {
      out = {
        ...view,
        events: view.events.filter((e) => e.seq > prev.seq),
        // 动物外观在牌局中几乎不变：没变化就不重复发送，客户端沿用上一次的
        players: view.players.map((p) => (prev.profiles.get(p.id) === profiles.get(p.id) ? ({ ...p, profile: undefined } as unknown as typeof p) : p)),
        eventsDelta: true,
      };
    }
    s.sent = { game, conn: s.conn, hand: view.handNumber, seq: lastSeq, profiles };
    s.conn.send({ t: 'state', view: out });
  }
}
