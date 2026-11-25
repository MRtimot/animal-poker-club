import { Card } from '../cards/card';
import { Deck } from '../cards/deck';
import { evaluateHand, HandResult } from '../poker/handEvaluator';
import { calculatePots, splitPot } from '../betting/pots';
import { RNG, secureRandom } from '../utils/random';
import {
  ActionType,
  Award,
  EnginePlayer,
  GameEvent,
  GameEventBody,
  HandSummary,
  LegalActions,
  Phase,
  PlayerAction,
  ShownHand,
} from './types';
import { canTransition } from './stateMachine';

export interface EngineConfig {
  smallBlind: number;
  bigBlind: number;
  rng?: RNG;
}

export class PokerError extends Error {}

/** 牌桌引擎的完整状态（可 JSON 序列化，用于多台服务器共享牌局） */
export interface EngineState {
  players: EnginePlayer[];
  board: Card[];
  phase: Phase;
  handNumber: number;
  dealerSeat: number;
  sbSeat: number;
  bbSeat: number;
  currentIndex: number;
  currentBet: number;
  lastRaiseSize: number;
  pendingAdvance: boolean;
  events: GameEvent[];
  lastSummary: HandSummary | null;
  revealed: string[];
  shownHands: ShownHand[];
  smallBlind: number;
  bigBlind: number;
  deck: { cards: Card[]; dealt: Card[] };
  seq: number;
}

/**
 * 德州扑克牌桌状态机（权威逻辑）。
 * - 不含任何计时器 / 网络 / UI：由外部控制器调用 startHand / act / advance。
 * - 下注轮结束后 pendingAdvance = true，由控制器在动画间隔后调用 advance() 推进到下一街。
 */
export class PokerEngine {
  players: EnginePlayer[] = [];
  board: Card[] = [];
  phase: Phase = 'idle';
  handNumber = 0;
  dealerSeat = -1;
  sbSeat = -1;
  bbSeat = -1;
  /** 当前轮到的玩家在 players 数组中的下标（-1 = 无） */
  currentIndex = -1;
  currentBet = 0;
  lastRaiseSize = 0;
  pendingAdvance = false;
  events: GameEvent[] = [];
  lastSummary: HandSummary | null = null;
  revealed = new Set<string>();
  shownHands: ShownHand[] = [];

  smallBlind: number;
  bigBlind: number;
  private deck: Deck;
  private seq = 0;

  constructor(cfg: EngineConfig) {
    this.smallBlind = cfg.smallBlind;
    this.bigBlind = cfg.bigBlind;
    this.deck = new Deck(cfg.rng ?? secureRandom);
  }

  toState(): EngineState {
    return {
      players: this.players,
      board: this.board,
      phase: this.phase,
      handNumber: this.handNumber,
      dealerSeat: this.dealerSeat,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      currentIndex: this.currentIndex,
      currentBet: this.currentBet,
      lastRaiseSize: this.lastRaiseSize,
      pendingAdvance: this.pendingAdvance,
      events: this.events,
      lastSummary: this.lastSummary,
      revealed: [...this.revealed],
      shownHands: this.shownHands,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      deck: this.deck.toState(),
      seq: this.seq,
    };
  }

  static fromState(s: EngineState, rng: RNG = secureRandom): PokerEngine {
    const e = new PokerEngine({ smallBlind: s.smallBlind, bigBlind: s.bigBlind, rng });
    e.players = s.players;
    e.board = s.board;
    e.phase = s.phase;
    e.handNumber = s.handNumber;
    e.dealerSeat = s.dealerSeat;
    e.sbSeat = s.sbSeat;
    e.bbSeat = s.bbSeat;
    e.currentIndex = s.currentIndex;
    e.currentBet = s.currentBet;
    e.lastRaiseSize = s.lastRaiseSize;
    e.pendingAdvance = s.pendingAdvance;
    e.events = s.events;
    e.lastSummary = s.lastSummary;
    e.revealed = new Set(s.revealed);
    e.shownHands = s.shownHands;
    e.deck = Deck.fromState(s.deck, rng);
    e.seq = s.seq;
    return e;
  }

  // ───────────── 玩家管理 ─────────────

  addPlayer(id: string, name: string, chips: number, seat?: number): EnginePlayer {
    if (this.players.some((p) => p.id === id)) throw new PokerError('玩家已在桌上');
    if (this.players.length >= 8) throw new PokerError('牌桌已满（最多 8 人）');
    const used = new Set(this.players.map((p) => p.seat));
    let s = seat ?? 0;
    while (used.has(s)) s++;
    const p: EnginePlayer = {
      id, name, seat: s, chips, hole: [], bet: 0, totalBet: 0, folded: false, allIn: false,
      acted: false, inHand: false, sittingOut: false, lastAction: null,
    };
    this.players.push(p);
    this.players.sort((a, b) => a.seat - b.seat);
    return p;
  }

  removePlayer(id: string): void {
    const p = this.getPlayer(id);
    if (!p) return;
    if (this.isHandActive() && p.inHand) {
      // 手牌进行中：标记离开，自动弃牌
      p.sittingOut = true;
      if (!p.folded && this.players[this.currentIndex]?.id === id && !this.pendingAdvance) {
        this.act(id, { type: 'fold' });
      } else if (!p.folded) {
        this.foldOutOfTurn(p);
      }
      return;
    }
    this.players = this.players.filter((x) => x.id !== id);
  }

  /** 非轮到自己时弃牌（离开牌桌 / 断线超时） */
  foldOutOfTurn(p: EnginePlayer): void {
    if (p.folded || !p.inHand) return;
    p.folded = true;
    p.lastAction = { type: 'fold', amount: p.bet };
    this.emit({ type: 'action', playerId: p.id, action: 'fold', added: 0, betTo: p.bet, allIn: false });
    const active = this.activePlayers();
    if (active.length === 1) {
      this.finishUncontested(active[0]);
      return;
    }
    const cur = this.currentPlayer;
    if (cur && !this.pendingAdvance && !this.needsToAct(cur)) this.moveToNextActor();
  }

  getPlayer(id: string): EnginePlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  get currentPlayer(): EnginePlayer | null {
    return this.currentIndex >= 0 ? this.players[this.currentIndex] ?? null : null;
  }

  isHandActive(): boolean {
    return this.phase !== 'idle' && this.phase !== 'complete';
  }

  /** 还有筹码、可以参加下一手的玩家 */
  playersWithChips(): EnginePlayer[] {
    return this.players.filter((p) => p.chips > 0 && !p.sittingOut);
  }

  canStartHand(): boolean {
    return !this.isHandActive() && this.playersWithChips().length >= 2;
  }

  // ───────────── 事件 ─────────────

  /** 阶段只能按状态机前进（见 stateMachine.ts）；非法跳转说明引擎有错误，立即报错而不是继续发错牌 */
  private setPhase(to: Phase): void {
    if (!canTransition(this.phase, to)) throw new PokerError(`非法的阶段跳转：${this.phase} → ${to}`);
    this.phase = to;
  }

  private emit(e: GameEventBody): void {
    this.events.push({ ...e, seq: ++this.seq, t: Date.now() } as GameEvent);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  get lastSeq(): number {
    return this.seq;
  }

  // ───────────── 一手牌流程 ─────────────

  /** 从 fromSeatIndex 之后寻找下一个满足条件的玩家下标 */
  private nextIndex(fromIndex: number, pred: (p: EnginePlayer) => boolean): number {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (((fromIndex + k) % n) + n) % n;
      if (pred(this.players[i])) return i;
    }
    return -1;
  }

  private indexOfSeat(seat: number): number {
    return this.players.findIndex((p) => p.seat === seat);
  }

  startHand(): void {
    if (this.isHandActive()) throw new PokerError('上一手牌尚未结束');
    const eligible = this.playersWithChips();
    if (eligible.length < 2) throw new PokerError('至少需要 2 名有筹码的玩家');

    this.handNumber++;
    this.board = [];
    this.revealed.clear();
    this.shownHands = [];
    this.lastSummary = null;
    this.pendingAdvance = false;
    this.events = [];
    for (const p of this.players) {
      p.hole = [];
      p.bet = 0;
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      p.acted = false;
      p.lastAction = null;
      p.inHand = p.chips > 0 && !p.sittingOut;
    }

    // 庄家按钮：顺时针移动到下一位有筹码的玩家
    const prevDealerIdx = this.dealerSeat < 0 ? -1 : this.indexOfSeatOrBefore(this.dealerSeat);
    const dIdx = this.nextIndex(prevDealerIdx, (p) => p.inHand);
    this.dealerSeat = this.players[dIdx].seat;

    const headsUp = eligible.length === 2;
    const sbIdx = headsUp ? dIdx : this.nextIndex(dIdx, (p) => p.inHand);
    const bbIdx = this.nextIndex(sbIdx, (p) => p.inHand);
    this.sbSeat = this.players[sbIdx].seat;
    this.bbSeat = this.players[bbIdx].seat;

    this.emit({
      type: 'handStart',
      handNumber: this.handNumber,
      dealerId: this.players[dIdx].id,
      sbId: this.players[sbIdx].id,
      bbId: this.players[bbIdx].id,
    });

    this.deck.reset();
    this.deck.shuffle();

    this.setPhase('preflop');
    this.currentBet = 0;
    this.postBlind(this.players[sbIdx], this.smallBlind, 'sb');
    this.postBlind(this.players[bbIdx], this.bigBlind, 'bb');
    this.currentBet = this.bigBlind;
    this.lastRaiseSize = this.bigBlind;

    // 发底牌：从小盲开始，每人一张，共两轮
    const order: string[] = [];
    for (let round = 0; round < 2; round++) {
      let i = sbIdx;
      for (let k = 0; k < eligible.length; k++) {
        const p = this.players[i];
        p.hole.push(this.deck.deal());
        order.push(p.id);
        i = this.nextIndex(i, (x) => x.inHand);
      }
    }
    this.emit({ type: 'dealHole', order });

    this.currentIndex = bbIdx;
    this.moveToNextActor();
  }

  /** 若原庄家已离桌，找到其座位之前最近的玩家下标 */
  private indexOfSeatOrBefore(seat: number): number {
    const exact = this.indexOfSeat(seat);
    if (exact >= 0) return exact;
    let best = -1;
    for (let i = 0; i < this.players.length; i++) if (this.players[i].seat < seat) best = i;
    return best >= 0 ? best : this.players.length - 1;
  }

  private postBlind(p: EnginePlayer, amount: number, kind: 'sb' | 'bb'): void {
    const amt = Math.min(amount, p.chips);
    p.chips -= amt;
    p.bet += amt;
    p.totalBet += amt;
    if (p.chips === 0) p.allIn = true;
    p.lastAction = { type: kind, amount: amt };
    this.emit({ type: 'blind', playerId: p.id, amount: amt, kind });
  }

  private canActPlayer(p: EnginePlayer): boolean {
    return p.inHand && !p.folded && !p.allIn;
  }

  private needsToAct(p: EnginePlayer): boolean {
    if (!this.canActPlayer(p)) return false;
    if (p.bet < this.currentBet) {
      // 其他还在局中的人都已全押、而且谁都没有超过我的下注（例如单挑时大盲筹码不足、全押的金额比小盲还少）：
      // 没有什么需要跟的，直接摊牌。否则会要求跟注一笔注定退回的筹码，超时还会被自动弃牌、白白输掉
      return this.players.some((x) => x !== p && x.inHand && !x.folded && (!x.allIn || x.bet > p.bet));
    }
    if (p.acted) return false;
    // 还没行动过：只有在还有其他可行动玩家时才需要行动
    const others = this.players.filter((x) => x !== p && this.canActPlayer(x)).length;
    return others > 0;
  }

  private activePlayers(): EnginePlayer[] {
    return this.players.filter((p) => p.inHand && !p.folded);
  }

  private moveToNextActor(): void {
    const idx = this.nextIndex(this.currentIndex, (p) => this.needsToAct(p));
    if (idx < 0) {
      this.currentIndex = -1;
      this.pendingAdvance = true;
      return;
    }
    this.currentIndex = idx;
    this.emit({ type: 'turn', playerId: this.players[idx].id });
  }

  getLegalActions(playerId: string): LegalActions | null {
    const p = this.currentPlayer;
    if (!p || p.id !== playerId || !this.isHandActive() || this.pendingAdvance) return null;
    const toCall = Math.max(0, this.currentBet - p.bet);
    const othersCanAct = this.players.some((x) => x !== p && this.canActPlayer(x));
    const maxRaiseTo = p.bet + p.chips;
    const minRaiseTo = Math.min(this.currentBet + Math.max(this.lastRaiseSize, this.bigBlind), maxRaiseTo);
    const canRaise = !p.acted && othersCanAct && p.chips > toCall;
    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, p.chips),
      toCall,
      canRaise,
      minRaiseTo,
      maxRaiseTo,
      canAllIn: p.chips > 0 && (canRaise || p.chips <= toCall),
      allInAmount: p.chips,
    };
  }

  act(playerId: string, action: PlayerAction): void {
    const p = this.currentPlayer;
    if (!p || p.id !== playerId) throw new PokerError('还没轮到你行动');
    const legal = this.getLegalActions(playerId);
    if (!legal) throw new PokerError('当前无法行动');

    let type: ActionType = action.type;
    let added = 0;

    switch (type) {
      case 'fold':
        p.folded = true;
        break;
      case 'check':
        if (!legal.canCheck) throw new PokerError('当前不能过牌，需要跟注或弃牌');
        break;
      case 'call': {
        if (!legal.canCall) {
          if (legal.canCheck) {
            type = 'check';
            break;
          }
          throw new PokerError('当前不能跟注');
        }
        added = this.putChips(p, legal.callAmount);
        if (p.allIn) type = 'allin';
        break;
      }
      case 'raise': {
        if (!legal.canRaise) throw new PokerError('当前不能加注');
        // NaN / Infinity / 非数字会让所有比较都为 false，必须在这里拦截，否则筹码会变成 NaN
        if (typeof action.amount !== 'number' || !Number.isFinite(action.amount)) throw new PokerError('加注金额无效');
        const to = Math.floor(action.amount);
        if (to > legal.maxRaiseTo) throw new PokerError('筹码不足');
        if (to < legal.minRaiseTo && to !== legal.maxRaiseTo) {
          throw new PokerError(`加注至少到 ${legal.minRaiseTo}`);
        }
        if (to <= this.currentBet) throw new PokerError('加注金额必须高于当前下注');
        added = this.applyRaiseTo(p, to);
        if (p.allIn) type = 'allin';
        break;
      }
      case 'allin': {
        if (!legal.canAllIn) throw new PokerError('当前不能全押');
        const to = p.bet + p.chips;
        if (to > this.currentBet) added = this.applyRaiseTo(p, to);
        else added = this.putChips(p, p.chips);
        break;
      }
      default:
        throw new PokerError('未知操作');
    }

    p.acted = true;
    p.lastAction = { type, amount: p.bet };
    this.emit({ type: 'action', playerId: p.id, action: type, added, betTo: p.bet, allIn: p.allIn });
    this.afterAction();
  }

  private putChips(p: EnginePlayer, amount: number): number {
    const amt = Math.min(amount, p.chips);
    p.chips -= amt;
    p.bet += amt;
    p.totalBet += amt;
    if (p.chips === 0) p.allIn = true;
    return amt;
  }

  private applyRaiseTo(p: EnginePlayer, to: number): number {
    const raiseSize = to - this.currentBet;
    const added = this.putChips(p, to - p.bet);
    if (raiseSize >= this.lastRaiseSize) {
      // 完整加注：重新开放所有人的行动
      this.lastRaiseSize = raiseSize;
      for (const x of this.players) if (x !== p) x.acted = false;
    }
    // 不足额全押加注：不重新开放已行动玩家的加注权，但他们仍需跟注或弃牌
    this.currentBet = Math.max(this.currentBet, p.bet);
    return added;
  }

  private afterAction(): void {
    const active = this.activePlayers();
    if (active.length === 1) {
      this.finishUncontested(active[0]);
      return;
    }
    this.moveToNextActor();
  }

  /** 由控制器在动画延迟后调用：收集下注 → 发下一街 / 摊牌 */
  advance(): void {
    if (!this.pendingAdvance || !this.isHandActive()) return;
    this.pendingAdvance = false;
    this.collectBets();

    if (this.phase === 'river') {
      this.showdown();
      return;
    }
    const next: Record<string, Phase> = { preflop: 'flop', flop: 'turn', turn: 'river' };
    this.setPhase(next[this.phase]);
    this.deck.burn();
    const n = this.phase === 'flop' ? 3 : 1;
    const cards = this.deck.dealMany(n);
    this.board.push(...cards);
    this.emit({ type: 'board', street: this.phase as 'flop' | 'turn' | 'river', cards });

    this.currentBet = 0;
    this.lastRaiseSize = this.bigBlind;
    for (const p of this.players) {
      p.acted = false;
      if (p.inHand && !p.folded && !p.allIn) p.lastAction = null;
    }
    // 翻牌后从庄家左手第一位开始
    this.currentIndex = this.indexOfSeat(this.dealerSeat);
    if (this.currentIndex < 0) this.currentIndex = this.indexOfSeatOrBefore(this.dealerSeat);
    this.moveToNextActor();
  }

  private collectBets(): void {
    const amounts = this.players.filter((p) => p.bet > 0).map((p) => ({ playerId: p.id, amount: p.bet }));
    for (const p of this.players) p.bet = 0;
    if (amounts.length) this.emit({ type: 'collect', amounts });
  }

  /** 已收进底池的筹码（不含当前街下注） */
  get collectedPot(): number {
    return this.players.reduce((s, p) => s + p.totalBet - p.bet, 0);
  }

  get totalPot(): number {
    return this.players.reduce((s, p) => s + p.totalBet, 0);
  }

  /**
   * 当前的主池 / 边池结构（供界面显示）。
   * 只有出现全押时才拆分边池；按已收入底池的筹码计算，避免把正常的未跟注下注显示成边池。
   */
  currentPots(): number[] {
    const collected = this.collectedPot;
    if (!this.players.some((p) => p.inHand && p.allIn)) return collected > 0 ? [collected] : [];
    const { pots, refunds } = calculatePots(
      this.players
        .filter((p) => p.totalBet - p.bet > 0)
        .map((p) => ({ playerId: p.id, amount: p.totalBet - p.bet, folded: p.folded })),
    );
    const out = pots.map((p) => p.amount);
    const refund = refunds.reduce((s, r) => s + r.amount, 0);
    if (refund && out.length) out[out.length - 1] += refund;
    return out;
  }

  private finishUncontested(winner: EnginePlayer): void {
    this.collectBets();
    const amount = this.totalPot;
    winner.chips += amount;
    this.currentIndex = -1;
    this.pendingAdvance = false;
    const awards: Award[] = [{ playerId: winner.id, amount, potIndex: 0 }];
    this.emit({ type: 'win', awards, uncontested: true, pots: [amount] });
    this.lastSummary = {
      handNumber: this.handNumber,
      winners: [{ playerId: winner.id, amount }],
      shown: [],
      uncontested: true,
      board: [...this.board],
    };
    this.endHand();
  }

  private showdown(): void {
    this.setPhase('showdown');
    this.currentIndex = -1;
    const contenders = this.activePlayers();
    const results = new Map<string, HandResult>();
    const shown: ShownHand[] = [];
    for (const p of contenders) {
      const r = evaluateHand([...p.hole, ...this.board]);
      results.set(p.id, r);
      this.revealed.add(p.id);
      shown.push({ playerId: p.id, cards: [...p.hole], handName: r.name, bestCards: r.cards, category: r.category });
    }
    this.shownHands = shown;
    this.emit({ type: 'showdown', hands: shown });

    const { pots, refunds } = calculatePots(
      this.players.filter((p) => p.totalBet > 0).map((p) => ({ playerId: p.id, amount: p.totalBet, folded: p.folded })),
    );
    for (const r of refunds) {
      const p = this.getPlayer(r.playerId)!;
      p.chips += r.amount;
      this.emit({ type: 'refund', playerId: r.playerId, amount: r.amount });
    }

    // 零头分配顺序：从庄家左手第一位开始
    const dIdx = this.indexOfSeatOrBefore(this.dealerSeat);
    const orderIndex = (id: string) => {
      const i = this.players.findIndex((p) => p.id === id);
      return (i - dIdx - 1 + this.players.length) % this.players.length;
    };

    const awards: Award[] = [];
    pots.forEach((pot, potIndex) => {
      const eligible = pot.eligible.filter((id) => results.has(id));
      let best = -1;
      let winners: string[] = [];
      for (const id of eligible) {
        const s = results.get(id)!.score;
        if (s > best) {
          best = s;
          winners = [id];
        } else if (s === best) winners.push(id);
      }
      winners.sort((a, b) => orderIndex(a) - orderIndex(b));
      const split = splitPot(pot.amount, winners);
      for (const [id, amount] of split) {
        this.getPlayer(id)!.chips += amount;
        awards.push({ playerId: id, amount, potIndex, handName: results.get(id)!.name });
      }
    });

    this.emit({ type: 'win', awards, uncontested: false, pots: pots.map((p) => p.amount) });

    const merged = new Map<string, { playerId: string; amount: number; handName?: string }>();
    for (const a of awards) {
      const m = merged.get(a.playerId);
      if (m) m.amount += a.amount;
      else merged.set(a.playerId, { playerId: a.playerId, amount: a.amount, handName: a.handName });
    }
    this.lastSummary = {
      handNumber: this.handNumber,
      winners: [...merged.values()],
      shown,
      uncontested: false,
      board: [...this.board],
    };
    this.endHand();
  }

  private endHand(): void {
    this.setPhase('complete');
    this.currentIndex = -1;
    for (const p of this.players) {
      p.bet = 0;
    }
    this.emit({ type: 'handEnd' });
  }

  /** 若需要，玩家自愿亮牌 */
  reveal(playerId: string): void {
    if (this.getPlayer(playerId)) this.revealed.add(playerId);
  }

  /** 校验：桌上筹码总量守恒（测试用） */
  totalChips(): number {
    return this.players.reduce((s, p) => s + p.chips + p.totalBet * (this.isHandActive() ? 1 : 0), 0);
  }
}
