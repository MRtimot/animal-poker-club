// 21 点控制器：驱动引擎的节奏（下注倒计时、发牌、AI 思考、行动计时、庄家逐张补牌、下一局），
// 与德州扑克的 GameController 同形：浏览器（本地）与服务器（在线）共用；状态可 JSON 保存，任何一台服务器都能接手。
// 规则与结果全部在 BlackjackEngine；这里只决定“什么时候走下一步”和“谁说一句话”。
import type { AIPersonality } from '../ai/ai';
import { DEFAULT_DIALOGUE_RULES, DialogueDirector, type DialogueRef, type DirectorState } from '../character/dialogue';
import { resolveVoiceProfile } from '../character/voice';
import type { PlayerProfile } from '../player/profile';
import { secureRandom, type RNG } from '../utils/random';
import { BlackjackEngine, BlackjackError, type BlackjackEngineState } from './engine';
import { cardPoints, evaluateBlackjack } from './hand';
import type { BlackjackRules } from './rules';
import { aiAction, aiBet } from './strategy';
import {
  BJ_ACTIONS,
  DEALER_ID,
  type BjAction,
  type BjCommand,
  type BjEconomy,
  type BjHand,
  type BjHandView,
  type BjRoundFacts,
  type BlackjackView,
} from './types';
import type { BjDialogueEvent } from './dialogue';

/** 节奏（毫秒）。客户端的发牌动画与服务器共用同一份数字 */
export const BJ_TIMING = {
  /** 发牌时相邻两张牌的间隔 */
  card: 320,
  /** 最后一张发出后，等它落桌翻开 */
  dealSettle: 1150,
  dealerReveal: 1250,
  dealerCard: 1350,
  dealerFinish: 900,
  autoNext: 8500,
  betCountdown: 15000,
} as const;

export interface BjSeatConfig {
  id: string;
  profile: PlayerProfile;
  chips: number;
  isAI: boolean;
  aiPersonality?: AIPersonality;
}

export interface BlackjackOptions {
  rules?: Partial<BlackjackRules>;
  /** 单人桌：下注与行动没有倒计时，一局结束后等玩家点“下一局” */
  solo?: boolean;
  economy?: BjEconomy;
  /** 桌上筹码用完后补充到多少（table 经济） */
  startingChips?: number;
  turnTimeMs?: number;
  offlineTurnMs?: number;
  betTimeMs?: number;
  pace?: number;
  dealer: { profile: PlayerProfile; trait: string };
  rng?: RNG;
  aiRng?: RNG;
  autoRun?: boolean;
}

/** 外部挂钩：不参与规则，只提供持久金币与结算回调 */
export interface BlackjackHooks {
  /** 持久金币（每局开始前校正手里的筹码） */
  balanceOf?: (playerId: string) => number | null;
  /** 金币不够最低下注时补充；返回补充后的数额，不允许时返回 null */
  /**
   * 金币 / 筹码不够最低下注时补充（tableChips：桌上筹码模式补到的数额）。
   * 返回补充后的数额；返回文字 = 不允许的原因（例如今天的次数用完）；null = 暂时不能补充。
   * 没有提供时：持久金币不能补充，桌上筹码不限次数。
   */
  refill?: (playerId: string, tableChips: number) => number | string | null;
  /** 这名玩家还能补充几次（null = 不限 / 不适用），只用于显示（本地牌桌使用；服务器发送视图时另外计算） */
  refillsLeft?: (playerId: string) => number | null;
  /** 一局结算（每局恰好一次） */
  onRound?: (results: { playerId: string; facts: BjRoundFacts }[], roundId: string) => void;
  onChat?: (playerId: string, text: string, dialogue: DialogueRef) => void;
}

export type BjPending =
  | { kind: 'openBetting'; at: number }
  | { kind: 'closeBetting'; at: number }
  | { kind: 'deal'; at: number }
  | { kind: 'beginTurns'; at: number }
  | { kind: 'runAI'; at: number; playerId: string }
  | { kind: 'autoStand'; at: number; playerId: string; token: number }
  | { kind: 'dealer'; at: number };
type PendingInput = BjPending extends infer P ? (P extends BjPending ? Omit<P, 'at'> : never) : never;

interface Meta {
  id: string;
  profile: PlayerProfile;
  isAI: boolean;
  aiPersonality?: AIPersonality;
  connected: boolean;
}

interface Opts {
  solo: boolean;
  economy: BjEconomy;
  startingChips: number;
  turnTimeMs: number;
  offlineTurnMs: number;
  betTimeMs: number;
  pace: number;
}

export interface BlackjackState {
  kind: 'blackjack';
  engine: BlackjackEngineState;
  meta: Meta[];
  pending: BjPending | null;
  turnDeadline: number | null;
  turnTotalMs: number;
  nextRoundAt: number | null;
  opts: Opts;
  dealer: { profile: PlayerProfile; trait: string };
  spokenSeq: number;
  dialogue?: DirectorState;
}

export class BlackjackController {
  engine: BlackjackEngine;
  hooks: BlackjackHooks = {};
  private meta = new Map<string, Meta>();
  private pending: BjPending | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline: number | null = null;
  private turnTotalMs = 0;
  private nextRoundAt: number | null = null;
  private stopped = false;
  private autoRun: boolean;
  private listeners = new Set<() => void>();
  private opts: Opts;
  private aiRng: RNG;
  private director: DialogueDirector;
  private spokenSeq = 0;
  /** 正在推进的时刻：后续步骤都从这一刻算起（一次推进不会把还没到时间的步骤连锁跑完） */
  private clock = 0;
  readonly dealer: { profile: PlayerProfile; trait: string };

  constructor(seats: BjSeatConfig[], o: BlackjackOptions) {
    const solo = !!o.solo;
    this.opts = {
      solo,
      economy: o.economy ?? 'table',
      startingChips: o.startingChips ?? 1000,
      turnTimeMs: o.turnTimeMs ?? (solo ? 0 : 20000),
      offlineTurnMs: o.offlineTurnMs ?? (solo ? 90000 : 6000),
      betTimeMs: o.betTimeMs ?? BJ_TIMING.betCountdown,
      pace: o.pace ?? 1,
    };
    this.aiRng = o.aiRng ?? Math.random;
    this.autoRun = o.autoRun ?? true;
    this.dealer = o.dealer;
    this.engine = new BlackjackEngine(o.rules, o.rng ?? secureRandom);
    this.director = this.makeDirector();
    for (const s of seats) {
      this.engine.addPlayer(s.id, s.profile.name, s.chips);
      this.meta.set(s.id, { id: s.id, profile: s.profile, isAI: s.isAI, aiPersonality: s.aiPersonality, connected: true });
    }
  }

  private makeDirector(state?: DirectorState) {
    const p = this.opts.pace;
    return new DialogueDirector(this.aiRng, { ...DEFAULT_DIALOGUE_RULES, minIntervalMs: 3500 * p, perSpeakerMs: 5000 * p, maxPerHand: 4, thinkMs: 20000 * p }, state);
  }

  // ───────────── 运行 ─────────────

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() {
    for (const fn of [...this.listeners]) fn();
  }
  private delay(ms: number) {
    return ms * this.opts.pace;
  }
  private now() {
    return Math.max(Date.now(), this.clock);
  }

  start() {
    this.schedule(this.delay(900), { kind: 'openBetting' });
    this.notify();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private schedule(ms: number, step: PendingInput) {
    this.pending = { ...step, at: this.now() + Math.max(0, ms) } as BjPending;
    this.arm();
  }

  private clearPending() {
    this.pending = null;
    this.arm();
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const p = this.pending;
    if (!this.autoRun || this.stopped || !p) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (this.pending === p) this.tick(Math.max(Date.now(), p.at));
      },
      Math.max(0, p.at - Date.now()),
    );
  }

  nextWakeAt(): number | null {
    return this.stopped ? null : (this.pending?.at ?? null);
  }

  /** 执行到时间的步骤；返回是否有变化 */
  tick(now = Date.now()): boolean {
    let ran = false;
    this.clock = now;
    try {
      for (let guard = 0; guard < 20 && !this.stopped && this.pending && this.pending.at <= now; guard++) {
        const p = this.pending;
        this.pending = null;
        ran = true;
        this.step(p);
      }
    } finally {
      this.clock = 0;
    }
    return ran;
  }

  private step(p: BjPending) {
    const e = this.engine;
    switch (p.kind) {
      case 'openBetting':
        this.openBetting();
        return;
      case 'closeBetting':
        for (const x of this.waitingForBet()) e.skipBet(x.id);
        this.deal();
        return;
      case 'deal':
        this.deal();
        return;
      case 'beginTurns':
        if (e.phase === 'dealing') e.beginTurns();
        this.plan();
        return;
      case 'runAI':
        this.runAI(p.playerId);
        return;
      case 'autoStand':
        if (e.token === p.token) e.autoStand(p.playerId);
        this.plan();
        return;
      case 'dealer':
        if (e.phase === 'dealer-turn') e.dealerStep();
        this.plan();
        return;
    }
  }

  // ───────────── 下注阶段 ─────────────

  private isHuman = (id: string) => !this.meta.get(id)?.isAI;

  private openBetting() {
    const e = this.engine;
    if (e.phase !== 'idle' && e.phase !== 'round-end') return;
    this.nextRoundAt = null;
    this.turnDeadline = null;
    e.openBetting();
    for (const p of e.players) {
      const m = this.meta.get(p.id);
      if (!m) continue;
      if (m.isAI) {
        // 同桌的 AI 动物输光了：俱乐部补给，继续陪玩（不影响任何玩家）
        if (!e.canBet(p)) e.setBalance(p.id, this.opts.startingChips);
        const bet = aiBet(m.aiPersonality ?? 'smartCat', e.rules.minBet, e.rules.maxBet, p.balance, this.aiRng);
        if (bet > 0) e.placeBet(p.id, bet);
        else e.skipBet(p.id);
        continue;
      }
      const real = this.hooks.balanceOf?.(p.id);
      if (typeof real === 'number') e.setBalance(p.id, real);
    }
    this.react();
    this.bettingCheck();
  }

  /** 还没表态、但可以下注的在线真人 */
  private waitingForBet() {
    const e = this.engine;
    return e.players.filter((p) => this.isHuman(p.id) && this.meta.get(p.id)?.connected && p.bet === 0 && !p.skipped && e.canBet(p));
  }

  /**
   * 下注阶段的节奏：没有真人下注时不计时（空桌不会一直空转、浪费服务器额度）；
   * 多人桌有人下注后开始倒计时；所有人都表态后马上发牌。
   */
  private bettingCheck() {
    const e = this.engine;
    if (e.phase !== 'betting') return this.notify();
    const humanBet = e.players.some((p) => this.isHuman(p.id) && p.bet > 0);
    if (!humanBet) {
      this.turnDeadline = null;
      this.clearPending();
    } else if (!this.waitingForBet().length) {
      this.turnDeadline = null;
      if (this.pending?.kind !== 'deal') this.schedule(this.delay(700), { kind: 'deal' });
    } else if (this.pending?.kind !== 'closeBetting') {
      this.turnTotalMs = this.opts.betTimeMs;
      this.turnDeadline = this.now() + this.opts.betTimeMs;
      this.schedule(this.opts.betTimeMs, { kind: 'closeBetting' });
    }
    this.notify();
  }

  private deal() {
    const e = this.engine;
    this.turnDeadline = null;
    if (e.phase !== 'betting' || !e.players.some((p) => this.isHuman(p.id) && p.bet > 0)) return this.bettingCheck();
    e.deal();
    const cards = e.players.filter((p) => p.hands.length).length * 2 + 2;
    this.schedule(this.delay(cards * BJ_TIMING.card + BJ_TIMING.dealSettle), { kind: 'beginTurns' });
    this.notify();
  }

  // ───────────── 行动阶段 ─────────────

  /** 根据当前阶段安排下一步 */
  private plan() {
    const e = this.engine;
    this.turnDeadline = null;
    this.react();
    switch (e.phase) {
      case 'player-turn': {
        const id = e.current!.playerId;
        const m = this.meta.get(id);
        if (m?.isAI) {
          this.schedule(this.delay(750 + this.aiRng() * 900), { kind: 'runAI', playerId: id });
          break;
        }
        const limit = m?.connected ? this.opts.turnTimeMs : this.opts.offlineTurnMs;
        if (limit > 0) {
          this.turnTotalMs = limit;
          this.turnDeadline = this.now() + limit;
          this.schedule(limit, { kind: 'autoStand', playerId: id, token: e.token });
        } else this.clearPending();
        break;
      }
      case 'dealer-turn': {
        const last = e.events[e.events.length - 1];
        const ms = !e.holeRevealed ? BJ_TIMING.dealerReveal : last?.type === 'dealerBust' || !e.dealerMustHit() ? BJ_TIMING.dealerFinish : BJ_TIMING.dealerCard;
        this.schedule(this.delay(ms), { kind: 'dealer' });
        break;
      }
      case 'round-end':
        this.complete();
        break;
    }
    this.notify();
  }

  private runAI(id: string) {
    const e = this.engine;
    const legal = e.getLegal(id);
    const hand = e.getPlayer(id)?.hands.find((h) => h.id === e.current?.handId);
    if (!legal || !hand) return this.plan();
    let action: BjAction = 'stand';
    try {
      action = aiAction(hand.cards, cardPoints(e.dealer[0]), legal, this.meta.get(id)?.aiPersonality ?? 'smartCat', this.aiRng);
    } catch {
      /* 策略出错：停牌 */
    }
    if ((action === 'double' && !legal.double) || (action === 'split' && !legal.split)) action = 'stand';
    e.act(id, action);
    this.plan();
  }

  /** 一局结束：通知结算（恰好一次），多人桌安排下一局 */
  private complete() {
    const e = this.engine;
    if (this.pending?.kind === 'openBetting') return;
    const results = e.players.flatMap((p) => {
      const facts = e.factsOf(p.id);
      return facts ? [{ playerId: p.id, facts }] : [];
    });
    this.hooks.onRound?.(results, e.roundId);
    this.scheduleNext();
  }

  private anyHumanOnline() {
    return this.engine.players.some((p) => !p.left && this.isHuman(p.id) && this.meta.get(p.id)?.connected);
  }

  private scheduleNext() {
    if (this.opts.solo || !this.anyHumanOnline()) {
      this.nextRoundAt = null;
      this.clearPending();
      return;
    }
    const wait = this.delay(BJ_TIMING.autoNext);
    this.nextRoundAt = this.now() + wait;
    this.schedule(wait, { kind: 'openBetting' });
  }

  // ───────────── 玩家命令 ─────────────

  /**
   * 玩家的命令（本地界面或网络）。返回给玩家看的错误，或 null。
   * round：命令针对第几局；token：行动令牌。过期 / 重复的命令一律拒绝，不会多发一张牌。
   */
  handle(playerId: string, cmd: BjCommand, ref: { round?: number; token?: number } = {}): string | null {
    const e = this.engine;
    const m = this.meta.get(playerId);
    const p = e.getPlayer(playerId);
    if (!m || m.isAI || !p || p.left) return '你不在这张牌桌上';
    if (ref.round !== undefined && ref.round !== e.round) return '这一局已经结束';
    try {
      switch (cmd.type) {
        case 'bet':
          this.syncWallet(playerId);
          e.placeBet(playerId, cmd.amount);
          this.react();
          this.bettingCheck();
          return null;
        case 'skip':
          e.skipBet(playerId);
          this.bettingCheck();
          return null;
        case 'next':
          if (!this.opts.solo || e.phase !== 'round-end') return '现在不能执行这个操作';
          if (this.pending?.kind !== 'openBetting') this.schedule(this.delay(120), { kind: 'openBetting' });
          this.notify();
          return null;
        case 'rebuy': {
          if (e.phase !== 'betting' && e.phase !== 'round-end') return '现在不能执行这个操作';
          if (e.canBet(p)) return '筹码还够，不需要补充';
          const next = this.hooks.refill ? this.hooks.refill(playerId, this.opts.startingChips) : this.opts.economy === 'profile' ? null : this.opts.startingChips;
          if (typeof next === 'string') return next;
          if (next === null) return '暂时无法补充筹码';
          e.setBalance(playerId, next);
          p.skipped = false;
          this.bettingCheck();
          return null;
        }
        default:
          if (!BJ_ACTIONS.includes(cmd.type)) return '无效操作';
          if (cmd.type === 'double' || cmd.type === 'split') this.syncWallet(playerId);
          e.act(playerId, cmd.type, ref.token);
          this.plan();
          return null;
      }
    } catch (err) {
      if (err instanceof BlackjackError) return err.message;
      console.error('[21 点] 处理操作出错', err);
      return '牌局暂时无法继续';
    }
  }

  /** 押上筹码之前核对持久金币：同一账号可能在别的牌桌上刚押过（同一笔筹码不能押两次） */
  private syncWallet(playerId: string) {
    const real = this.hooks.balanceOf?.(playerId);
    const p = this.engine.getPlayer(playerId);
    if (typeof real !== 'number' || !p) return;
    const free = Math.max(0, real - this.heldBy(playerId));
    if (free < p.balance) p.balance = free;
  }

  setConnected(playerId: string, connected: boolean) {
    const m = this.meta.get(playerId);
    if (!m || m.connected === connected) return;
    m.connected = connected;
    const e = this.engine;
    if (e.phase === 'betting') return this.bettingCheck();
    if (connected) {
      if (e.phase === 'round-end' && !this.pending) this.scheduleNext();
      // 单人桌没有行动计时：重新连上后取消断线期间的自动停牌
      if (e.phase === 'player-turn' && e.current?.playerId === playerId && this.opts.turnTimeMs === 0) {
        this.turnDeadline = null;
        this.clearPending();
      }
    } else if (e.phase === 'player-turn' && e.current?.playerId === playerId) {
      // 只会缩短、不会延长：不能靠反复断线拖时间
      const now = this.now();
      const left = Math.max(0, Math.min(this.opts.offlineTurnMs, (this.turnDeadline ?? Infinity) - now));
      this.turnTotalMs = this.opts.offlineTurnMs;
      this.turnDeadline = now + left;
      this.schedule(left, { kind: 'autoStand', playerId, token: e.token });
    }
    this.notify();
  }

  /** 玩家离开：下注阶段退回下注；一局进行中放弃这一局的手牌 */
  removePlayer(playerId: string) {
    const e = this.engine;
    if (!e.getPlayer(playerId)) return;
    const mark = () => `${e.phase}|${e.token}`;
    const before = mark();
    e.removePlayer(playerId);
    const m = this.meta.get(playerId);
    if (m) m.connected = false;
    if (e.phase === 'betting') return this.bettingCheck();
    // 不影响轮次：不重新计时
    if (mark() === before) this.notify();
    else this.plan();
  }

  /** 一局中途离开要承担的结果：桌上的全部下注算输（没有参加这一局时为 null） */
  forfeitFacts(playerId: string): BjRoundFacts | null {
    const e = this.engine;
    const p = e.getPlayer(playerId);
    if (!p || p.left || !e.inRound() || !p.hands.length) return null;
    const bet = p.hands.reduce((s, h) => s + h.bet, 0);
    return { roundId: e.roundId, bet, payout: 0, profit: -bet, hands: p.hands.map((h) => ({ result: 'forfeit', value: 0, cards: h.cards.length, doubled: h.doubled, fromSplit: h.fromSplit })) };
  }

  getMeta(id: string) {
    return this.meta.get(id);
  }

  /** 现在可以整桌离开 / 换模式（不在一局中间） */
  betweenRounds(): boolean {
    return !this.engine.inRound() && !(this.engine.phase === 'betting' && this.engine.players.some((p) => this.isHuman(p.id) && p.bet > 0));
  }

  /** 某位玩家桌上还没结算的筹码（同一账号在两张桌上时，防止同一笔金币押两次） */
  heldBy(playerId: string): number {
    const e = this.engine;
    const p = e.getPlayer(playerId);
    if (!p) return 0;
    if (e.phase === 'betting') return p.bet;
    return e.inRound() ? p.hands.reduce((s, h) => s + h.bet, 0) : 0;
  }

  // ───────────── 台词（只看公开信息；人物性格不影响任何结果） ─────────────

  private say(id: string, event: BjDialogueEvent, value?: number) {
    if (!this.hooks.onChat) return;
    const m = this.meta.get(id);
    const animal = id === DEALER_ID ? this.dealer.profile.animal : m?.profile.animal;
    if (!animal) return;
    const line = this.director.consider(
      { id, species: animal.species, style: resolveVoiceProfile(animal).style, isAI: id === DEALER_ID || !!m?.isAI },
      event,
      this.engine.round,
    );
    if (line) this.hooks.onChat(id, line.text.replace('{v}', String(value ?? '')), line.ref);
  }

  /** 根据新发生的事件说话 */
  private react() {
    const e = this.engine;
    const fresh = e.events.filter((x) => x.seq > this.spokenSeq);
    const last = e.events[e.events.length - 1];
    if (last) this.spokenSeq = last.seq;
    if (!this.hooks.onChat) return;
    for (const x of fresh) {
      switch (x.type) {
        case 'roundStart':
          if (x.round === 1) this.say(DEALER_ID, 'bjd_greet');
          break;
        case 'blackjack':
          this.say(x.playerId, 'bj_blackjack');
          if (this.isHuman(x.playerId)) this.say(DEALER_ID, 'bjd_player_bj');
          break;
        case 'hit': {
          this.say(x.playerId, 'bj_hit');
          // 庄家看到已经很大的牌还要：打趣一句（只看桌面上的明牌）
          const h = this.findHand(x.handId);
          if (h && this.isHuman(x.playerId) && evaluateBlackjack(h.cards.slice(0, -1), true).value >= 15) this.say(DEALER_ID, 'bjd_tease');
          break;
        }
        case 'stand':
          if (!x.auto) this.say(x.playerId, 'bj_stand');
          break;
        case 'double':
          this.say(x.playerId, 'bj_double');
          break;
        case 'split':
          this.say(x.playerId, 'bj_split');
          break;
        case 'bust':
          this.say(x.playerId, 'bj_bust');
          break;
        case 'dealerBlackjack':
          this.say(DEALER_ID, 'bjd_blackjack');
          break;
        case 'dealerStand':
          this.say(DEALER_ID, 'bjd_stand', x.value);
          break;
        case 'dealerBust':
          this.say(DEALER_ID, 'bjd_bust');
          break;
        case 'payout': {
          if (!this.isHuman(x.playerId)) break;
          this.say(x.playerId, x.profit > 0 ? 'bj_win' : x.profit < 0 ? 'bj_lose' : 'bj_push');
          this.say(DEALER_ID, x.profit > 0 ? 'bjd_lose' : x.profit < 0 ? 'bjd_win' : 'bjd_push');
          break;
        }
      }
    }
  }

  private findHand(id: string): BjHand | undefined {
    for (const p of this.engine.players) for (const h of p.hands) if (h.id === id) return h;
    return undefined;
  }

  // ───────────── 保存 / 恢复 / 视图 ─────────────

  toState(): BlackjackState {
    return {
      kind: 'blackjack',
      engine: this.engine.toState(),
      meta: [...this.meta.values()],
      pending: this.pending,
      turnDeadline: this.turnDeadline,
      turnTotalMs: this.turnTotalMs,
      nextRoundAt: this.nextRoundAt,
      opts: this.opts,
      dealer: this.dealer,
      spokenSeq: this.spokenSeq,
      dialogue: this.director.toState(),
    };
  }

  static fromState(s: BlackjackState, extra: Pick<BlackjackOptions, 'autoRun' | 'rng' | 'aiRng'> = {}): BlackjackController {
    const c = new BlackjackController([], { ...s.opts, rules: s.engine.rules, dealer: s.dealer, autoRun: extra.autoRun ?? false, aiRng: extra.aiRng, rng: extra.rng });
    c.engine = BlackjackEngine.fromState(s.engine, extra.rng);
    c.meta = new Map(s.meta.map((m) => [m.id, m]));
    c.pending = s.pending;
    c.turnDeadline = s.turnDeadline;
    c.turnTotalMs = s.turnTotalMs;
    c.nextRoundAt = s.nextRoundAt;
    c.spokenSeq = s.spokenSeq;
    c.director = c.makeDirector(s.dialogue);
    c.arm();
    return c;
  }

  private handView(h: BjHand): BjHandView {
    const v = evaluateBlackjack(h.cards, h.fromSplit);
    return { id: h.id, cards: [...h.cards], value: v.value, soft: v.soft, blackjack: v.blackjack, bust: v.bust, bet: h.bet, done: h.done, doubled: h.doubled, fromSplit: h.fromSplit, result: h.result, payout: h.payout };
  }

  /** 发给某位玩家的视图：庄家暗牌翻开之前，任何字段都不含它的信息 */
  getView(viewerId: string): BlackjackView {
    const e = this.engine;
    const cards = e.dealer.map((c, i) => (i === 1 && !e.holeRevealed ? null : c));
    const d = evaluateBlackjack(cards.filter((c) => c !== null));
    return {
      kind: 'blackjack',
      viewerId,
      round: e.round,
      roundId: e.roundId,
      phase: e.phase,
      rules: e.rules,
      economy: this.opts.economy,
      refillsLeft: this.hooks.refillsLeft?.(viewerId) ?? null,
      solo: this.opts.solo,
      shoe: e.shoeInfo,
      dealer: { profile: this.dealer.profile, trait: this.dealer.trait, cards, revealed: e.holeRevealed, value: d.value, soft: d.soft, blackjack: e.holeRevealed && d.blackjack, bust: d.bust },
      players: e.players.map((p) => {
        const m = this.meta.get(p.id)!;
        return {
          id: p.id,
          name: p.name,
          seat: p.seat,
          isAI: m.isAI,
          aiPersonality: m.aiPersonality,
          connected: m.isAI || m.connected,
          left: p.left,
          profile: m.profile,
          balance: p.balance,
          bet: p.bet,
          skipped: p.skipped,
          hands: p.hands.map((h) => this.handView(h)),
          activeHand: p.activeHand,
        };
      }),
      currentPlayerId: e.current?.playerId ?? null,
      currentHandId: e.current?.handId ?? null,
      legal: e.getLegal(viewerId),
      token: e.token,
      turnDeadline: this.turnDeadline,
      turnTotalMs: this.turnTotalMs,
      nextRoundAt: this.nextRoundAt,
      // 复制一份：本地对局里引擎会继续往同一个数组里追加，旧视图不能跟着变
      events: [...e.events],
      serverTime: Date.now(),
    };
  }
}
