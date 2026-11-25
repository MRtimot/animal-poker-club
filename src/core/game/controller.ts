import { PokerEngine, PokerError, type EngineState } from '../table/engine';
import { PlayerAction } from '../table/types';
import { decideAction, AIPersonality, AIDifficulty } from '../ai/ai';
import { RNG, secureRandom } from '../utils/random';
import type { GameOverInfo, SeatConfig, SeatView, TableView } from './view';
import type { PlayerProfile } from '../player/profile';
import { DEFAULT_DIALOGUE_RULES, DialogueDirector, type DialogueContext, type DialogueEvent, type DialogueRef, type DirectorState } from '../character/dialogue';
import { estimateEquity, preflopStrength } from '../ai/equity';
import { resolveVoiceProfile } from '../character/voice';
import { HandCategory } from '../poker/handEvaluator';

export interface ControllerOptions {
  smallBlind: number;
  bigBlind: number;
  /** 每次行动的时间（毫秒） */
  turnTimeMs?: number;
  /** 断线玩家的自动行动时间 */
  offlineTurnMs?: number;
  /** 动画节奏倍率：测试中设为 0 加速 */
  pace?: number;
  rng?: RNG;
  aiRng?: RNG;
  /**
   * true（默认）：控制器自己用计时器推进牌局（浏览器本地对战、单进程服务器）。
   * false：由外部在 nextWakeAt() 时调用 tick()（多台服务器共享牌局时使用）。
   */
  autoRun?: boolean;
}

/** 下一步要做的事（用数据表示，而不是闭包，这样牌局可以保存后在另一台服务器上继续） */
export type PendingStep =
  | { kind: 'beginHand'; at: number }
  | { kind: 'advance'; at: number }
  | { kind: 'runAI'; at: number; playerId: string }
  | { kind: 'autoAct'; at: number; playerId: string }
  | { kind: 'finishGame'; at: number };

/** 控制器的完整状态（可 JSON 序列化） */
export interface ControllerState {
  engine: EngineState;
  meta: SeatMeta[];
  pending: PendingStep | null;
  turnDeadline: number | null;
  turnTotalMs: number;
  nextHandAt: number | null;
  bustOrder: string[];
  gameOver: GameOverInfo | null;
  paused: boolean;
  opts: { smallBlind: number; bigBlind: number; turnTimeMs: number; offlineTurnMs: number; pace: number };
  /** 台词导演的冷却状态（多台服务器接手牌局时也保持冷却） */
  dialogue?: DirectorState;
}

interface SeatMeta {
  id: string;
  profile: PlayerProfile;
  isAI: boolean;
  aiPersonality?: AIPersonality;
  aiDifficulty?: AIDifficulty;
  connected: boolean;
}

/** dialogue：角色台词（由这里决定说什么，客户端只负责显示与播放语音） */
export type ChatEmitter = (playerId: string, kind: 'chat' | 'emote', text: string, dialogue?: DialogueRef) => void;

/**
 * 游戏控制器：驱动牌桌引擎的节奏（发牌动画等待、AI 思考、行动计时、下一手）。
 * 在浏览器（本地 AI 对战）与服务器（在线房间）中共用同一份代码。
 */
/** 各性格的思考节奏：[最短毫秒, 随机范围] */
const AI_PACE: Record<string, [number, number]> = {
  aggressiveFox: [500, 900], // 激进：出手快
  cautiousPanda: [1200, 1700], // 保守：慢慢想
  crazyFrog: [300, 2400], // 疯狂：忽快忽慢
  smartCat: [900, 1300], // 聪明：稳定
  luckyRabbit: [600, 1600],
};

export class GameController {
  engine: PokerEngine;
  private meta = new Map<string, SeatMeta>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: PendingStep | null = null;
  private autoRun: boolean;
  private turnDeadline: number | null = null;
  private turnTotalMs = 0;
  private nextHandAt: number | null = null;
  private bustOrder: string[] = [];
  private gameOver: GameOverInfo | null = null;
  private listeners = new Set<() => void>();
  private stopped = false;
  paused = false;
  onChat: ChatEmitter | null = null;
  onHandComplete: (() => void) | null = null;

  private opts: ControllerState['opts'];
  private aiRng: RNG;
  private director!: DialogueDirector;

  constructor(seats: SeatConfig[], opts: ControllerOptions) {
    this.opts = {
      smallBlind: opts.smallBlind,
      bigBlind: opts.bigBlind,
      turnTimeMs: opts.turnTimeMs ?? 30000,
      offlineTurnMs: opts.offlineTurnMs ?? 6000,
      pace: opts.pace ?? 1,
    };
    this.aiRng = opts.aiRng ?? Math.random;
    this.autoRun = opts.autoRun ?? true;
    this.director = this.makeDirector();
    this.engine = new PokerEngine({ smallBlind: opts.smallBlind, bigBlind: opts.bigBlind, rng: opts.rng ?? secureRandom });
    seats.forEach((s, i) => {
      this.engine.addPlayer(s.id, s.profile.name, s.chips, i);
      this.meta.set(s.id, {
        id: s.id,
        profile: s.profile,
        isAI: s.isAI,
        aiPersonality: s.aiPersonality,
        aiDifficulty: s.aiDifficulty,
        connected: true,
      });
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  private delay(ms: number) {
    return ms * this.opts.pace;
  }

  start(): void {
    this.schedule(this.delay(1200), { kind: 'beginHand' });
    this.notify();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number, step: PendingStep extends infer P ? (P extends PendingStep ? Omit<P, 'at'> : never) : never) {
    this.pending = { ...step, at: Date.now() + Math.max(0, ms) } as PendingStep;
    this.arm();
  }

  /** 自动模式：为下一步设置计时器 */
  private arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.autoRun || this.stopped || !this.pending) return;
    const p = this.pending;
    this.timer = setTimeout(() => {
      this.timer = null;
      // 计时器可能比预定时间早触发 1 毫秒：按预定时间执行，避免牌局卡住
      if (this.pending === p) this.tick(Math.max(Date.now(), p.at));
    }, Math.max(0, p.at - Date.now()));
  }

  /** 下一步预定执行的时间（null = 没有待办） */
  nextWakeAt(): number | null {
    return this.stopped || this.gameOver ? null : (this.pending?.at ?? null);
  }

  /** 执行所有已经到时间的步骤；返回是否有变化 */
  tick(now = Date.now()): boolean {
    let ran = false;
    for (let guard = 0; guard < 20 && !this.stopped && this.pending && this.pending.at <= now; guard++) {
      const p = this.pending;
      this.pending = null;
      ran = true;
      switch (p.kind) {
        case 'beginHand':
          this.beginHand();
          break;
        case 'advance': {
          this.engine.advance();
          // 新的一街：给翻牌动画留时间
          this.afterChange(this.engine.phase === 'flop' ? this.delay(900) : this.delay(500));
          break;
        }
        case 'runAI':
          this.runAI(p.playerId);
          break;
        case 'autoAct':
          this.autoAct(p.playerId);
          break;
        case 'finishGame':
          this.finishGame();
          break;
      }
    }
    return ran;
  }

  private beginHand() {
    if (this.stopped || this.gameOver) return;
    if (this.paused) {
      this.schedule(this.delay(1000), { kind: 'beginHand' });
      return;
    }
    // 断线太久或已离开的玩家坐出
    if (!this.engine.canStartHand()) {
      this.finishGame();
      return;
    }
    this.nextHandAt = null;
    this.engine.startHand();
    if (this.engine.handNumber === 1) {
      // 开局：一只 AI 动物打个招呼
      const ais = this.engine.players.filter((p) => this.meta.get(p.id)?.isAI);
      if (ais.length) this.say(ais[Math.floor(this.aiRng() * ais.length) % ais.length].id, 'greet');
    }
    const n = this.engine.players.filter((p) => p.inHand).length;
    // 发牌动画：每张牌约 0.16 秒
    this.afterChange(this.delay(900 + n * 2 * 160));
  }

  /** 每次状态变化后决定下一步 */
  private afterChange(extraDelay = 0) {
    const e = this.engine;
    this.turnDeadline = null;

    if (e.phase === 'complete') {
      this.handleHandComplete();
      this.notify();
      return;
    }

    if (e.pendingAdvance) {
      const actors = e.players.filter((p) => p.inHand && !p.folded && !p.allIn).length;
      const runout = actors < 2;
      const wait = this.delay((runout ? 1700 : 1000) + extraDelay);
      this.schedule(wait, { kind: 'advance' });
      this.notify();
      return;
    }

    const cur = e.currentPlayer;
    if (!cur) {
      this.notify();
      return;
    }
    const meta = this.meta.get(cur.id)!;
    if (meta.isAI) {
      // 像真人一样思考：不同性格的思考时间不同，面对大注时更犹豫
      const pace = AI_PACE[meta.aiPersonality ?? 'smartCat'] ?? AI_PACE.smartCat;
      const legal = e.getLegalActions(cur.id);
      const facing = legal && legal.toCall > 0 ? Math.min(1, legal.toCall / Math.max(1, cur.chips)) : 0;
      const hesitate = facing > 0.3 ? 600 + this.aiRng() * 1400 * facing : 0;
      // 面对大注 / 全押：AI 可能先“嗯……让我想想”（有独立冷却，不会每次都说）
      const someoneAllIn = e.players.some((p) => p.id !== cur.id && p.inHand && !p.folded && p.allIn);
      if (legal && legal.toCall > 0 && (someoneAllIn || legal.toCall >= Math.max(e.bigBlind * 4, e.totalPot * 0.35))) this.say(cur.id, 'think');
      const think = this.delay(pace[0] + this.aiRng() * pace[1] + hesitate + extraDelay);
      this.turnTotalMs = think;
      this.schedule(think, { kind: 'runAI', playerId: cur.id });
    } else {
      const total = (meta.connected && !cur.sittingOut ? this.opts.turnTimeMs : this.opts.offlineTurnMs) + extraDelay;
      this.turnTotalMs = total;
      this.turnDeadline = Date.now() + total;
      this.schedule(total, { kind: 'autoAct', playerId: cur.id });
    }
    this.notify();
  }

  private autoAct(playerId: string) {
    const legal = this.engine.getLegalActions(playerId);
    if (!legal) return;
    this.applyAction(playerId, { type: legal.canCheck ? 'check' : 'fold' });
  }

  private runAI(playerId: string) {
    const e = this.engine;
    const p = e.getPlayer(playerId);
    const meta = this.meta.get(playerId);
    const legal = e.getLegalActions(playerId);
    if (!p || !meta || !legal) return;
    const opponents = e.players.filter((x) => x.inHand && !x.folded && x.id !== playerId).length;
    const facingRaise = e.events.some((ev) => ev.type === 'action' && (ev.action === 'raise' || ev.action === 'allin'));
    let decision;
    try {
      decision = decideAction(
        {
          hole: p.hole,
          board: e.board,
          phase: e.phase,
          pot: e.totalPot,
          legal,
          chips: p.chips,
          myBet: p.bet,
          currentBet: e.currentBet,
          bigBlind: e.bigBlind,
          opponents,
          facingRaise,
          rng: this.aiRng,
        },
        meta.aiPersonality ?? 'smartCat',
        meta.aiDifficulty ?? 'normal',
      );
    } catch {
      decision = { action: { type: legal.canCheck ? 'check' : 'fold' } as PlayerAction };
    }
    this.applyAction(playerId, decision.action);
    const done = this.engine.events.filter((ev) => ev.type === 'action' && ev.playerId === playerId).pop();
    const acted = done && done.type === 'action' ? done.action : decision.action.type;
    if (acted === 'raise' || acted === 'allin' || acted === 'call' || acted === 'check' || acted === 'fold') {
      // 台词知道自己的牌力：牌好、牌差、诈唬时说的话不一样（牌力只在这里用，不会发给其他玩家）
      const eq = typeof decision.equity === 'number' ? decision.equity : 0.5;
      this.say(playerId, acted, {
        strength: strengthOf(eq),
        bluff: (acted === 'raise' || acted === 'allin') && eq < 0.36,
        bigPot: e.totalPot >= e.bigBlind * 20,
      });
    }
  }

  /** 快速估算一只 AI 动物现在的牌力（用于挑选反应台词） */
  private quickStrength(playerId: string): DialogueContext['strength'] {
    const e = this.engine;
    const p = e.getPlayer(playerId);
    if (!p || p.hole.length < 2) return undefined;
    try {
      const opponents = Math.max(1, e.players.filter((x) => x.inHand && !x.folded && x.id !== playerId).length);
      const eq = e.board.length ? estimateEquity(p.hole, e.board, opponents, 120, this.aiRng) : preflopStrength(p.hole) * 0.8 + 0.1;
      return strengthOf(eq);
    } catch {
      return undefined;
    }
  }

  private makeDirector(state?: DirectorState) {
    const pace = this.opts.pace;
    return new DialogueDirector(
      this.aiRng,
      {
        minIntervalMs: DEFAULT_DIALOGUE_RULES.minIntervalMs * pace,
        perSpeakerMs: DEFAULT_DIALOGUE_RULES.perSpeakerMs * pace,
        maxPerHand: DEFAULT_DIALOGUE_RULES.maxPerHand,
        thinkMs: (DEFAULT_DIALOGUE_RULES.thinkMs ?? 20000) * pace,
      },
      state,
    );
  }

  /** 让一只动物按性格说一句台词（是否开口、说什么由台词导演决定：冷却、每手上限、优先级） */
  private say(playerId: string, event: DialogueEvent, ctx: DialogueContext = {}): boolean {
    if (!this.onChat) return false;
    const m = this.meta.get(playerId);
    if (!m) return false;
    const animal = m.profile.animal;
    const line = this.director.consider(
      { id: playerId, species: animal.species, style: resolveVoiceProfile(animal).style, catchphrase: animal.catchphrase, isAI: m.isAI },
      event,
      this.engine.handNumber,
      Date.now(),
      ctx,
    );
    if (!line) return false;
    this.onChat(playerId, 'chat', line.text, line.ref);
    return true;
  }

  /** 真人玩家加注 / 全押时，桌上的一只 AI 动物可能会做出反应 */
  private reactToHuman(playerId: string) {
    const last = this.engine.events.filter((ev) => ev.type === 'action' && ev.playerId === playerId).pop();
    if (!last || last.type !== 'action') return;
    const event: DialogueEvent | null = last.action === 'allin' ? 'react_allin' : last.action === 'raise' ? 'react_raise' : null;
    if (!event) return;
    const ais = this.engine.players.filter((p) => p.id !== playerId && p.inHand && !p.folded && this.meta.get(p.id)?.isAI);
    if (ais.length) {
      const who = ais[Math.floor(this.aiRng() * ais.length) % ais.length];
      if (this.say(who.id, event, { strength: this.quickStrength(who.id), bigPot: this.engine.totalPot >= this.engine.bigBlind * 20 })) return;
    }
    // 没有 AI 回应时，全押的玩家自己的动物喊一声（重大时刻）
    if (event === 'react_allin') this.say(playerId, 'allin');
  }

  private applyAction(playerId: string, action: PlayerAction) {
    try {
      this.engine.act(playerId, action);
    } catch (err) {
      // 非法操作兜底：能过牌就过牌，否则弃牌
      const legal = this.engine.getLegalActions(playerId);
      if (!legal) return;
      this.engine.act(playerId, { type: legal.canCheck ? 'check' : 'fold' });
    }
    this.afterChange();
  }

  /** 人类玩家提交的操作（来自本地 UI 或网络）。返回错误信息或 null */
  handleAction(playerId: string, action: PlayerAction): string | null {
    const meta = this.meta.get(playerId);
    if (!meta || meta.isAI) return '无效的玩家';
    if (this.engine.pendingAdvance) return '请稍候，正在发牌';
    if (this.engine.currentPlayer?.id !== playerId) return '还没轮到你';
    try {
      this.engine.act(playerId, action);
    } catch (err) {
      if (err instanceof PokerError) return err.message;
      return '操作失败';
    }
    this.reactToHuman(playerId);
    this.afterChange();
    return null;
  }

  private handleHandComplete() {
    const e = this.engine;
    const summary = e.lastSummary;
    // 赢 / 输 / 诈唬成功 / 同花顺：动物按性格说话
    if (summary && this.onChat) {
      const amounts = new Map(summary.winners.map((w) => [w.playerId, w.amount]));
      const shown = new Map(summary.shown.map((h) => [h.playerId, h.category]));
      const raised = new Set(e.events.filter((ev) => ev.type === 'action' && (ev.action === 'raise' || ev.action === 'allin')).map((ev) => (ev as { playerId: string }).playerId));
      const order = [...e.players].sort((a, b) => (amounts.get(b.id) ?? 0) - (amounts.get(a.id) ?? 0));
      for (const p of order) {
        if (!p.inHand) continue;
        const won = amounts.get(p.id);
        const cat = shown.get(p.id) ?? -1;
        let event: DialogueEvent | null = null;
        if (won && cat >= HandCategory.StraightFlush) event = 'big_hand';
        else if (won && summary.uncontested && raised.has(p.id)) event = 'bluff_win';
        else if (won && won >= e.bigBlind * 25) event = 'win_big';
        else if (won) event = 'win';
        else if (!p.folded && p.totalBet > e.bigBlind * 4) event = 'lose';
        if (event) this.say(p.id, event);
      }
    }
    // 同一手有多人出局：这一手开始时筹码更多的人名次更高（出局的人本手投入 = 他开始时的全部筹码）
    const bust = e.players.filter((p) => p.chips === 0 && !this.bustOrder.includes(p.id)).sort((a, b) => a.totalBet - b.totalBet);
    for (const p of bust) this.bustOrder.push(p.id);
    this.onHandComplete?.();
    const alive = e.playersWithChips();
    const humansAlive = alive.some((p) => !this.meta.get(p.id)?.isAI);
    const wait = this.delay(summary && !summary.uncontested ? 6500 : 3800);
    if (alive.length < 2 || !humansAlive) {
      this.schedule(wait, { kind: 'finishGame' });
      this.nextHandAt = null;
    } else {
      this.nextHandAt = Date.now() + wait;
      this.schedule(wait, { kind: 'beginHand' });
    }
  }

  private finishGame() {
    const e = this.engine;
    const alive = [...e.players].filter((p) => !this.bustOrder.includes(p.id)).sort((a, b) => b.chips - a.chips);
    const order = [...alive.map((p) => p.id), ...[...this.bustOrder].reverse()];
    const rankings = order.map((id, i) => {
      const p = e.getPlayer(id)!;
      return { playerId: id, name: p.name, chips: p.chips, place: i + 1 };
    });
    this.gameOver = { rankings, winnerId: rankings[0]?.playerId ?? '' };
    this.nextHandAt = null;
    this.turnDeadline = null;
    this.pending = null;
    this.arm();
    this.notify();
  }

  isGameOver(): boolean {
    return !!this.gameOver;
  }

  setConnected(playerId: string, connected: boolean) {
    const m = this.meta.get(playerId);
    if (!m || m.connected === connected) return;
    m.connected = connected;
    // 轮到断线玩家：缩短计时
    if (!connected && this.engine.currentPlayer?.id === playerId && !this.engine.pendingAdvance) {
      // 只会缩短、不会延长：否则快到时间时断线再重连、反复几次，就能无限拖延这一回合
      const now = Date.now();
      const left = Math.max(0, Math.min(this.opts.offlineTurnMs, (this.turnDeadline ?? Infinity) - now));
      this.turnDeadline = now + left;
      this.turnTotalMs = this.opts.offlineTurnMs;
      this.schedule(left, { kind: 'autoAct', playerId });
    }
    this.notify();
  }

  /** 玩家离开房间：手牌中自动弃牌，并不再参与之后的牌局 */
  removePlayer(playerId: string) {
    const p = this.engine.getPlayer(playerId);
    if (!p) return;
    const wasCurrent = this.engine.currentPlayer?.id === playerId;
    p.sittingOut = true;
    const m = this.meta.get(playerId);
    if (m) m.connected = false;
    if (this.engine.isHandActive() && p.inHand && !p.folded) {
      const mark = () => `${this.engine.phase}|${this.engine.currentPlayer?.id ?? ''}|${this.engine.pendingAdvance}`;
      const before = mark();
      if (wasCurrent && !this.engine.pendingAdvance) this.engine.act(playerId, { type: 'fold' });
      else this.engine.foldOutOfTurn(p);
      // 不影响轮次（还是同一个人行动 / 还在等发牌）：不重新计时，别人离开不能让正在行动的人多出一整段时间
      if (mark() === before) this.notify();
      else this.afterChange();
    } else {
      this.notify();
    }
    // 离开者的筹码视为放弃
    if (!this.bustOrder.includes(playerId)) this.bustOrder.push(playerId);
  }

  updateProfile(playerId: string, profile: PlayerProfile) {
    const m = this.meta.get(playerId);
    if (m) {
      m.profile = profile;
      this.notify();
    }
  }

  getMeta(id: string) {
    return this.meta.get(id);
  }

  /** 保存完整牌局状态 */
  toState(): ControllerState {
    return {
      engine: this.engine.toState(),
      meta: [...this.meta.values()],
      pending: this.pending,
      turnDeadline: this.turnDeadline,
      turnTotalMs: this.turnTotalMs,
      nextHandAt: this.nextHandAt,
      bustOrder: this.bustOrder,
      gameOver: this.gameOver,
      paused: this.paused,
      opts: this.opts,
      dialogue: this.director.toState(),
    };
  }

  /** 从保存的状态恢复牌局（默认不自动推进，由外部调用 tick） */
  static fromState(s: ControllerState, extra: Pick<ControllerOptions, 'autoRun' | 'aiRng' | 'rng'> = {}): GameController {
    const c = new GameController([], { ...s.opts, autoRun: extra.autoRun ?? false, aiRng: extra.aiRng, rng: extra.rng });
    c.engine = PokerEngine.fromState(s.engine, extra.rng);
    c.meta = new Map(s.meta.map((m) => [m.id, m]));
    c.pending = s.pending;
    c.turnDeadline = s.turnDeadline;
    c.turnTotalMs = s.turnTotalMs;
    c.nextHandAt = s.nextHandAt;
    c.bustOrder = s.bustOrder;
    c.gameOver = s.gameOver;
    c.paused = s.paused;
    c.director = c.makeDirector(s.dialogue);
    c.arm();
    return c;
  }

  getView(viewerId: string): TableView {
    const e = this.engine;
    const showdown = e.phase === 'showdown' || e.phase === 'complete';
    const shownMap = new Map(e.shownHands.map((h) => [h.playerId, h]));
    const players: SeatView[] = e.players.map((p) => {
      const m = this.meta.get(p.id)!;
      const canSee = p.id === viewerId || (showdown && e.revealed.has(p.id));
      const shown = showdown ? shownMap.get(p.id) : undefined;
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        chips: p.chips,
        bet: p.bet,
        totalBet: p.totalBet,
        folded: p.folded,
        allIn: p.allIn,
        inHand: p.inHand,
        sittingOut: p.sittingOut,
        // 筹码输光的动物保留到下一手开始，让它播放完失败动画
        busted: p.chips === 0 && !p.inHand && e.handNumber > 0,
        isAI: m.isAI,
        aiPersonality: m.aiPersonality,
        connected: m.isAI ? true : m.connected,
        profile: m.profile,
        lastAction: p.lastAction,
        hole: p.hole.map((c) => (canSee ? c : null)),
        shown: shown ? { handName: shown.handName, bestCards: shown.bestCards, category: shown.category } : undefined,
      };
    });
    const dealer = e.players.find((p) => p.seat === e.dealerSeat);
    const sb = e.players.find((p) => p.seat === e.sbSeat);
    const bb = e.players.find((p) => p.seat === e.bbSeat);
    const active = e.isHandActive();
    return {
      viewerId,
      handNumber: e.handNumber,
      phase: e.phase,
      board: [...e.board],
      potCollected: active ? e.collectedPot : 0,
      potTotal: active ? e.totalPot : 0,
      pots: active ? e.currentPots() : [],
      currentBet: e.currentBet,
      currentPlayerId: e.currentPlayer?.id ?? null,
      dealerId: dealer?.id ?? null,
      sbId: sb?.id ?? null,
      bbId: bb?.id ?? null,
      smallBlind: e.smallBlind,
      bigBlind: e.bigBlind,
      players,
      legal: e.getLegalActions(viewerId),
      turnDeadline: this.turnDeadline,
      turnTotalMs: this.turnTotalMs,
      events: e.events,
      summary: e.lastSummary,
      gameOver: this.gameOver,
      nextHandAt: this.nextHandAt,
      serverTime: Date.now(),
      paused: this.paused,
    };
  }
}

/** 胜率 → 牌力档位（台词情境用） */
function strengthOf(eq: number): DialogueContext['strength'] {
  return eq >= 0.62 ? 'strong' : eq <= 0.36 ? 'weak' : 'medium';
}
