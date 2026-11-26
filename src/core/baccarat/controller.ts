// 百家乐控制器：驱动引擎的节奏（下注倒计时、停止下注、逐张开牌、结算、下一局），
// 与 21 点 / 德州的控制器同形：浏览器（本地）与服务器（在线）共用；状态可 JSON 保存，任何一台服务器都能接手。
// 规则与结果全部在 BaccaratEngine；这里只决定“什么时候走下一步”和“谁说一句话”。
import type { AIPersonality } from '../ai/ai';
import { DEFAULT_DIALOGUE_RULES, DialogueDirector, type DialogueRef, type DirectorState } from '../character/dialogue';
import { resolveVoiceProfile } from '../character/voice';
import type { PlayerProfile } from '../player/profile';
import { cryptoRandom, type RNG } from '../utils/random';
import type { BacDialogueEvent } from './dialogue';
import { BaccaratEngine, BaccaratError, type BaccaratEngineState } from './engine';
import { bacScore, betTotal, type BacBets, type BaccaratRules } from './rules';
import { BAC_DEALER_ID, type BacCommand, type BacEconomy, type BacRoundFacts, type BaccaratView } from './types';

/** 节奏（毫秒）。客户端的翻牌动画与服务器共用同一份数字 */
export const BAC_TIMING = {
  /** 停止下注后，第一张牌之前的安静 */
  closePause: 1100,
  /** 相邻两张牌 */
  card: 1050,
  /** 第三张牌（更慢，留给悬念） */
  thirdCard: 1600,
  /** 最后一张牌翻开后，宣布结果 */
  result: 1200,
  autoNext: 9000,
  betCountdown: 15000,
} as const;

export interface BacSeatConfig {
  id: string;
  profile: PlayerProfile;
  chips: number;
  isAI: boolean;
  aiPersonality?: AIPersonality;
}

export interface BaccaratOptions {
  rules?: Partial<BaccaratRules>;
  /** 单人桌：下注没有倒计时，一局结束后等玩家点“下一局” */
  solo?: boolean;
  economy?: BacEconomy;
  startingChips?: number;
  betTimeMs?: number;
  pace?: number;
  dealer: { profile: PlayerProfile; trait: string };
  rng?: RNG;
  /** 同桌 AI 动物的下注与台词（不碰牌靴） */
  aiRng?: RNG;
  autoRun?: boolean;
}

export interface BaccaratHooks {
  balanceOf?: (playerId: string) => number | null;
  /**
   * 金币 / 筹码不够最低下注时补充（tableChips：桌上筹码模式补到的数额）。
   * 返回补充后的数额；返回文字 = 不允许的原因（例如今天的次数用完）；null = 暂时不能补充。
   * 没有提供时：持久金币不能补充，桌上筹码不限次数。
   */
  refill?: (playerId: string, tableChips: number) => number | string | null;
  /** 这名玩家还能补充几次（null = 不限 / 不适用），只用于显示（本地牌桌使用；服务器发送视图时另外计算） */
  refillsLeft?: (playerId: string) => number | null;
  /** 一局结算（每局恰好一次；中途离开的玩家在离开时另外结算，不在这里） */
  onRound?: (results: { playerId: string; facts: BacRoundFacts }[], roundId: string) => void;
  onChat?: (playerId: string, text: string, dialogue: DialogueRef) => void;
}

export type BacPending =
  | { kind: 'openBetting'; at: number }
  | { kind: 'closeBetting'; at: number }
  | { kind: 'close'; at: number }
  | { kind: 'reveal'; at: number }
  | { kind: 'resolve'; at: number };
type PendingInput = BacPending extends infer P ? (P extends BacPending ? Omit<P, 'at'> : never) : never;

interface Meta {
  id: string;
  profile: PlayerProfile;
  isAI: boolean;
  aiPersonality?: AIPersonality;
  connected: boolean;
}

interface Opts {
  solo: boolean;
  economy: BacEconomy;
  startingChips: number;
  betTimeMs: number;
  pace: number;
}

export interface BaccaratState {
  kind: 'baccarat';
  engine: BaccaratEngineState;
  meta: Meta[];
  pending: BacPending | null;
  turnDeadline: number | null;
  turnTotalMs: number;
  nextRoundAt: number | null;
  opts: Opts;
  dealer: { profile: PlayerProfile; trait: string };
  spokenSeq: number;
  dialogue?: DirectorState;
}

/** 同桌 AI 动物怎么下注（只是性格表现：押哪边对它们自己的输赢有影响，对牌没有任何影响） */
export function aiBacBet(who: AIPersonality, min: number, max: number, balance: number, rng: RNG): Partial<BacBets> | null {
  const cap = Math.min(max, balance);
  if (cap < min) return null;
  const units = (n: number) => Math.min(cap, min * n);
  const side = (): 'player' | 'banker' => (rng() < 0.5 ? 'player' : 'banker');
  switch (who) {
    case 'smartCat':
      return { banker: units(2) };
    case 'cautiousPanda':
      return { [side()]: min };
    case 'aggressiveFox':
      return { [side()]: units(3 + Math.floor(rng() * 3)) };
    case 'crazyFrog': {
      const out: Partial<BacBets> = { [side()]: units(1 + Math.floor(rng() * 4)) };
      if (rng() < 0.4 && cap >= (out.player ?? out.banker ?? 0) + min) out.tie = min;
      return out;
    }
    default:
      return { [side()]: units(1 + Math.floor(rng() * 2)) };
  }
}

export class BaccaratController {
  engine: BaccaratEngine;
  hooks: BaccaratHooks = {};
  private meta = new Map<string, Meta>();
  private pending: BacPending | null = null;
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
  /** 正在推进的时刻：一次推进不会把还没到时间的步骤连锁跑完 */
  private clock = 0;
  readonly dealer: { profile: PlayerProfile; trait: string };

  constructor(seats: BacSeatConfig[], o: BaccaratOptions) {
    const solo = !!o.solo;
    this.opts = {
      solo,
      economy: o.economy ?? 'table',
      startingChips: o.startingChips ?? 1000,
      betTimeMs: o.betTimeMs ?? BAC_TIMING.betCountdown,
      pace: o.pace ?? 1,
    };
    this.aiRng = o.aiRng ?? Math.random;
    this.autoRun = o.autoRun ?? true;
    this.dealer = o.dealer;
    this.engine = new BaccaratEngine(o.rules, o.rng ?? cryptoRandom);
    this.director = this.makeDirector();
    for (const s of seats) {
      this.engine.addPlayer(s.id, s.profile.name, s.chips);
      this.meta.set(s.id, { id: s.id, profile: s.profile, isAI: s.isAI, aiPersonality: s.aiPersonality, connected: true });
    }
  }

  private makeDirector(state?: DirectorState) {
    const p = this.opts.pace;
    return new DialogueDirector(this.aiRng, { ...DEFAULT_DIALOGUE_RULES, minIntervalMs: 3000 * p, perSpeakerMs: 4500 * p, maxPerHand: 4, thinkMs: 20000 * p }, state);
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
    this.pending = { ...step, at: this.now() + Math.max(0, ms) } as BacPending;
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

  private step(p: BacPending) {
    const e = this.engine;
    switch (p.kind) {
      case 'openBetting':
        this.openBetting();
        return;
      case 'closeBetting':
        for (const x of this.waitingForBet()) e.skipBet(x.id);
        this.close();
        return;
      case 'close':
        this.close();
        return;
      case 'reveal':
        this.reveal();
        return;
      case 'resolve':
        if (e.phase === 'dealing' && !e.hasMoreCards()) e.resolve();
        this.react();
        this.complete();
        return;
    }
  }

  // ───────────── 下注 ─────────────

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
        if (!e.canBet(p)) e.setBalance(p.id, this.opts.startingChips);
        const bets = aiBacBet(m.aiPersonality ?? 'smartCat', e.rules.minBet, e.rules.maxBet, p.balance, this.aiRng);
        try {
          if (bets) e.placeBet(p.id, bets);
          else e.skipBet(p.id);
        } catch {
          e.skipBet(p.id);
        }
        continue;
      }
      const real = this.hooks.balanceOf?.(p.id);
      if (typeof real === 'number') e.setBalance(p.id, real);
    }
    this.react();
    this.bettingCheck();
  }

  private waitingForBet() {
    const e = this.engine;
    return e.players.filter((p) => this.isHuman(p.id) && this.meta.get(p.id)?.connected && !p.placed && !p.skipped && e.canBet(p));
  }

  /** 没有真人下注时不计时；多人桌有人下注后开始倒计时；所有人都表态后马上停止下注 */
  private bettingCheck() {
    const e = this.engine;
    if (e.phase !== 'betting') return this.notify();
    const humanBet = e.players.some((p) => this.isHuman(p.id) && p.placed);
    if (!humanBet) {
      this.turnDeadline = null;
      this.clearPending();
    } else if (!this.waitingForBet().length) {
      this.turnDeadline = null;
      if (this.pending?.kind !== 'close') this.schedule(this.delay(600), { kind: 'close' });
    } else if (this.pending?.kind !== 'closeBetting') {
      this.turnTotalMs = this.opts.betTimeMs;
      this.turnDeadline = this.now() + this.opts.betTimeMs;
      this.schedule(this.opts.betTimeMs, { kind: 'closeBetting' });
    }
    this.notify();
  }

  private close() {
    const e = this.engine;
    this.turnDeadline = null;
    if (e.phase !== 'betting' || !e.players.some((p) => this.isHuman(p.id) && p.placed)) return this.bettingCheck();
    e.closeBetting();
    this.react();
    this.schedule(this.delay(BAC_TIMING.closePause), { kind: 'reveal' });
    this.notify();
  }

  private reveal() {
    const e = this.engine;
    if ((e.phase !== 'closed' && e.phase !== 'dealing') || !e.hasMoreCards()) return;
    e.revealNext();
    this.react();
    if (e.hasMoreCards()) {
      const next = e.plan[e.revealed];
      this.schedule(this.delay(next.index === 2 ? BAC_TIMING.thirdCard : BAC_TIMING.card), { kind: 'reveal' });
    } else this.schedule(this.delay(BAC_TIMING.result), { kind: 'resolve' });
    this.notify();
  }

  private complete() {
    const e = this.engine;
    if (e.phase !== 'round-end' || this.pending?.kind === 'openBetting') return this.notify();
    const results = e.players.flatMap((p) => {
      if (p.left) return [];
      const facts = e.factsOf(p.id);
      return facts ? [{ playerId: p.id, facts }] : [];
    });
    this.hooks.onRound?.(results, e.roundId);
    this.scheduleNext();
    this.notify();
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
    const wait = this.delay(BAC_TIMING.autoNext);
    this.nextRoundAt = this.now() + wait;
    this.schedule(wait, { kind: 'openBetting' });
  }

  // ───────────── 玩家命令 ─────────────

  /** round：命令针对第几局（上一局的命令一律拒绝） */
  handle(playerId: string, cmd: BacCommand, ref: { round?: number } = {}): string | null {
    const e = this.engine;
    const m = this.meta.get(playerId);
    const p = e.getPlayer(playerId);
    if (!m || m.isAI || !p || p.left) return '你不在这张牌桌上';
    if (ref.round !== undefined && ref.round !== e.round) return '这一局已经结束';
    try {
      switch (cmd.type) {
        case 'bet':
          this.syncWallet(playerId);
          e.placeBet(playerId, cmd.bets);
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
          return '无效操作';
      }
    } catch (err) {
      if (err instanceof BaccaratError) return err.message;
      console.error('[百家乐] 处理操作出错', err);
      return '牌局暂时无法继续';
    }
  }

  /** 下注之前核对持久金币：同一账号可能在别的牌桌上刚押过 */
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
    if (connected && e.phase === 'round-end' && !this.pending) this.scheduleNext();
    this.notify();
  }

  /** 玩家离开：下注阶段退回下注；一局进行中下注已经锁定，结果照常（调用者先用 leaveFacts 结算） */
  removePlayer(playerId: string) {
    const e = this.engine;
    if (!e.getPlayer(playerId)) return;
    e.removePlayer(playerId);
    const m = this.meta.get(playerId);
    if (m) m.connected = false;
    if (e.phase === 'betting') return this.bettingCheck();
    this.notify();
  }

  /** 一局中途离开：按这一局真实的结果结算（停止下注时结果就已经确定） */
  leaveFacts(playerId: string): BacRoundFacts | null {
    const e = this.engine;
    const p = e.getPlayer(playerId);
    if (!p || p.left || !e.inRound()) return null;
    return e.factsOf(playerId);
  }

  getMeta(id: string) {
    return this.meta.get(id);
  }

  betweenRounds(): boolean {
    return !this.engine.inRound() && !(this.engine.phase === 'betting' && this.engine.players.some((p) => this.isHuman(p.id) && p.placed));
  }

  heldBy(playerId: string): number {
    const e = this.engine;
    const p = e.getPlayer(playerId);
    if (!p || !p.placed) return 0;
    return e.phase === 'betting' || e.inRound() ? betTotal(p.bets) : 0;
  }

  // ───────────── 台词（只看已经公开的事情；性格不影响任何结果） ─────────────

  private say(id: string, event: BacDialogueEvent, value?: number) {
    if (!this.hooks.onChat) return;
    const m = this.meta.get(id);
    const animal = id === BAC_DEALER_ID ? this.dealer.profile.animal : m?.profile.animal;
    if (!animal) return;
    const line = this.director.consider({ id, species: animal.species, style: resolveVoiceProfile(animal).style, isAI: id === BAC_DEALER_ID || !!m?.isAI }, event, this.engine.round);
    if (line) this.hooks.onChat(id, line.text.replace('{v}', String(value ?? '')), line.ref);
  }

  private react() {
    const e = this.engine;
    const fresh = e.events.filter((x) => x.seq > this.spokenSeq);
    const last = e.events[e.events.length - 1];
    if (last) this.spokenSeq = last.seq;
    if (!this.hooks.onChat) return;
    for (const x of fresh) {
      switch (x.type) {
        case 'roundStart':
          if (x.round === 1) this.say(BAC_DEALER_ID, 'bacd_greet');
          break;
        case 'bet':
          if (!this.isHuman(x.playerId)) {
            if (this.aiRng() < 0.35) this.say(x.playerId, 'bac_bet');
          } else if (betTotal(x.bets) >= e.rules.maxBet * 0.5 || x.bets.tie > 0) this.say(BAC_DEALER_ID, 'bacd_react_bet');
          break;
        case 'closed':
          this.say(BAC_DEALER_ID, 'bacd_close');
          break;
        case 'natural':
          this.say(BAC_DEALER_ID, 'bacd_natural', x.score);
          break;
        case 'rule':
          if (x.action === 'draw' && this.aiRng() < 0.5) this.say(BAC_DEALER_ID, 'bacd_draw');
          break;
        case 'result':
          if (x.winner === 'tie') this.say(BAC_DEALER_ID, 'bacd_tie');
          else this.say(BAC_DEALER_ID, x.winner === 'player' ? 'bacd_player_win' : 'bacd_banker_win', x.winner === 'player' ? x.player : x.banker);
          break;
        case 'payout': {
          const p = e.getPlayer(x.playerId);
          if (!p || p.left) break;
          if (p.bets.tie > 0 && p.returns.tie > 0) this.say(x.playerId, 'bac_tie_win');
          else this.say(x.playerId, x.profit > 0 ? 'bac_win' : x.profit < 0 ? 'bac_lose' : 'bac_push');
          break;
        }
      }
    }
  }

  // ───────────── 保存 / 恢复 / 视图 ─────────────

  toState(): BaccaratState {
    return {
      kind: 'baccarat',
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

  static fromState(s: BaccaratState, extra: Pick<BaccaratOptions, 'autoRun' | 'rng' | 'aiRng'> = {}): BaccaratController {
    const c = new BaccaratController([], { ...s.opts, rules: s.engine.rules, dealer: s.dealer, autoRun: extra.autoRun ?? false, aiRng: extra.aiRng, rng: extra.rng });
    c.engine = BaccaratEngine.fromState(s.engine, extra.rng);
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

  /** 发给某位玩家的视图：没公开的牌、牌靴顺序、尚未公布的结果都不在里面 */
  getView(viewerId: string): BaccaratView {
    const e = this.engine;
    const settled = e.phase === 'round-end' && e.winner !== null;
    const hand = (side: 'player' | 'banker') => {
      const cards = e.visible(side);
      return { cards, score: bacScore(cards), natural: cards.length === 2 && e.revealed >= 4 && bacScore(cards) >= 8 };
    };
    return {
      kind: 'baccarat',
      viewerId,
      round: e.round,
      roundId: e.roundId,
      phase: e.phase,
      rules: e.rules,
      economy: this.opts.economy,
      refillsLeft: this.hooks.refillsLeft?.(viewerId) ?? null,
      solo: this.opts.solo,
      shoe: e.shoeInfo,
      dealer: { profile: this.dealer.profile, trait: this.dealer.trait },
      hands: { player: hand('player'), banker: hand('banker') },
      result: settled ? { winner: e.winner!, player: bacScore(e.coup.player), banker: bacScore(e.coup.banker) } : null,
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
          bets: { ...p.bets },
          placed: p.placed,
          skipped: p.skipped,
          returns: settled && p.placed ? { ...p.returns } : null,
        };
      }),
      history: e.history.slice(-40),
      turnDeadline: this.turnDeadline,
      turnTotalMs: this.turnTotalMs,
      nextRoundAt: this.nextRoundAt,
      events: [...e.events],
      serverTime: Date.now(),
    };
  }
}
