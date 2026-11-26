// 21 点引擎：权威规则与状态机（纯逻辑，不含计时器 / 网络 / 界面）。
// 庄家按固定规则行动，没有任何随机决定；动物性格只影响表现层，永远碰不到牌靴。
import { cryptoRandom, randomId, type RNG } from '../utils/random';
import { evaluateBlackjack, isAce, isTenValue } from './hand';
import { betError, cleanRules, payoutFor, type BlackjackRules, type HandResult } from './rules';
import { Shoe, type BjCard, type ShoeState } from './shoe';
import { BJ_TRANSITIONS, DEALER_ID, type BjAction, type BjEvent, type BjEventBody, type BjHand, type BjLegal, type BjPlayer, type BjRoundFacts, type BlackjackPhase } from './types';

export class BlackjackError extends Error {}

export const MAX_BJ_PLAYERS = 6;

export interface BlackjackEngineState {
  rules: BlackjackRules;
  phase: BlackjackPhase;
  round: number;
  roundId: string;
  players: BjPlayer[];
  dealer: BjCard[];
  holeRevealed: boolean;
  current: { playerId: string; handId: string } | null;
  token: number;
  handSeq: number;
  events: BjEvent[];
  seq: number;
  shoe: ShoeState;
}

export class BlackjackEngine {
  readonly rules: BlackjackRules;
  phase: BlackjackPhase = 'idle';
  round = 0;
  roundId = '';
  players: BjPlayer[] = [];
  dealer: BjCard[] = [];
  holeRevealed = false;
  current: { playerId: string; handId: string } | null = null;
  /** 行动令牌：轮次或手牌每变化一次就 +1 */
  token = 0;
  events: BjEvent[] = [];
  private handSeq = 0;
  private seq = 0;
  private shoe: Shoe;

  constructor(rules?: Partial<BlackjackRules>, rng: RNG = cryptoRandom) {
    this.rules = cleanRules(rules);
    this.shoe = new Shoe(rng);
  }

  // ───────────── 保存 / 恢复 ─────────────

  toState(): BlackjackEngineState {
    return {
      rules: this.rules,
      phase: this.phase,
      round: this.round,
      roundId: this.roundId,
      players: this.players,
      dealer: this.dealer,
      holeRevealed: this.holeRevealed,
      current: this.current,
      token: this.token,
      handSeq: this.handSeq,
      events: this.events,
      seq: this.seq,
      shoe: this.shoe.toState(),
    };
  }

  static fromState(s: BlackjackEngineState, rng: RNG = cryptoRandom): BlackjackEngine {
    const e = new BlackjackEngine(s.rules, rng);
    e.phase = s.phase;
    e.round = s.round;
    e.roundId = s.roundId;
    e.players = s.players;
    e.dealer = s.dealer;
    e.holeRevealed = s.holeRevealed;
    e.current = s.current;
    e.token = s.token;
    e.handSeq = s.handSeq;
    e.events = s.events;
    e.seq = s.seq;
    e.shoe = Shoe.fromState(s.shoe, rng);
    return e;
  }

  get shoeInfo() {
    return { remaining: this.shoe.remaining, size: this.shoe.size };
  }

  // ───────────── 基础 ─────────────

  private setPhase(to: BlackjackPhase) {
    if (!BJ_TRANSITIONS[this.phase].includes(to)) throw new BlackjackError(`非法的阶段跳转：${this.phase} → ${to}`);
    this.phase = to;
  }

  private emit(e: BjEventBody) {
    this.events.push({ ...e, seq: ++this.seq } as BjEvent);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  getPlayer(id: string): BjPlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  private need(id: string): BjPlayer {
    const p = this.getPlayer(id);
    if (!p) throw new BlackjackError('你不在这张牌桌上');
    return p;
  }

  /** 一局正在进行（已经发牌，还没派彩完） */
  inRound(): boolean {
    return this.phase !== 'idle' && this.phase !== 'betting' && this.phase !== 'round-end';
  }

  addPlayer(id: string, name: string, balance: number): BjPlayer {
    if (this.getPlayer(id)) throw new BlackjackError('玩家已在桌上');
    if (this.players.length >= MAX_BJ_PLAYERS) throw new BlackjackError('牌桌已满');
    let seat = 0;
    while (this.players.some((p) => p.seat === seat)) seat++;
    const p: BjPlayer = { id, name, seat, balance: Math.max(0, Math.floor(balance)), bet: 0, skipped: false, hands: [], activeHand: 0, left: false };
    this.players.push(p);
    this.players.sort((a, b) => a.seat - b.seat);
    return p;
  }

  /** 玩家离开：下注阶段退回下注；一局进行中放弃这一局的全部手牌 */
  removePlayer(id: string) {
    const p = this.getPlayer(id);
    if (!p || p.left) return;
    this.emit({ type: 'left', playerId: id });
    if (!this.inRound() || !p.hands.length) {
      if (this.phase === 'betting') p.balance += p.bet;
      this.players = this.players.filter((x) => x.id !== id);
      return;
    }
    p.left = true;
    for (const h of p.hands) {
      h.forfeited = true;
      h.done = true;
    }
    if (this.current?.playerId === id) this.advanceTurn();
  }

  /** 校正手里的筹码（例如持久金币在别处变化）：只能在还没下注时 */
  setBalance(id: string, balance: number) {
    const p = this.getPlayer(id);
    if (!p || this.inRound() || p.bet > 0) return;
    p.balance = Math.max(0, Math.floor(balance));
  }

  // ───────────── 下注 ─────────────

  openBetting(roundId = `blackjack-round-${randomId(12)}`) {
    this.setPhase('betting');
    this.players = this.players.filter((p) => !p.left);
    this.round++;
    this.roundId = roundId;
    this.events = [];
    this.dealer = [];
    this.holeRevealed = false;
    this.current = null;
    this.token++;
    for (const p of this.players) {
      p.bet = 0;
      p.skipped = false;
      p.hands = [];
      p.activeHand = 0;
    }
    // 每一局一副新牌：上一局的牌整副丢弃
    this.shoe.newRound();
    this.emit({ type: 'shuffle' });
    this.emit({ type: 'roundStart', round: this.round, roundId });
  }

  canBet(p: BjPlayer): boolean {
    return !p.left && p.balance + p.bet >= this.rules.minBet;
  }

  placeBet(id: string, amount: number) {
    if (this.phase !== 'betting') throw new BlackjackError('现在不能下注');
    const p = this.need(id);
    if (p.bet > 0) throw new BlackjackError('你已经下注了');
    const err = betError(amount, p.balance, this.rules);
    if (err) throw new BlackjackError(err);
    p.balance -= amount;
    p.bet = amount;
    p.skipped = false;
    this.emit({ type: 'bet', playerId: id, amount });
  }

  skipBet(id: string) {
    if (this.phase !== 'betting') throw new BlackjackError('现在不能执行这个操作');
    const p = this.need(id);
    if (p.bet > 0) throw new BlackjackError('你已经下注了');
    if (p.skipped) return;
    p.skipped = true;
    this.emit({ type: 'skip', playerId: id });
  }

  hasBets(): boolean {
    return this.players.some((p) => p.bet > 0);
  }

  // ───────────── 发牌 ─────────────

  private newHand(p: BjPlayer, bet: number, cards: BjCard[] = [], fromSplit = false): BjHand {
    return { id: `${p.id}:${this.round}.${++this.handSeq}`, cards, bet, done: false, doubled: false, fromSplit, forfeited: false, result: null, payout: 0 };
  }

  private giveDealer(hidden: boolean) {
    const card = this.shoe.draw();
    this.dealer.push(card);
    this.emit({ type: 'card', to: DEALER_ID, handId: null, index: this.dealer.length - 1, card: hidden ? null : card, kind: hidden || this.dealer.length <= 2 ? 'deal' : 'hit' });
    return card;
  }

  private giveHand(p: BjPlayer, h: BjHand, kind: 'deal' | 'hit' | 'double' | 'split') {
    const card = this.shoe.draw();
    h.cards.push(card);
    this.emit({ type: 'card', to: p.id, handId: h.id, index: h.cards.length - 1, card, kind });
    return card;
  }

  /** 发牌：庄家明牌 → 每位玩家 → 庄家暗牌 → 每位玩家 */
  deal() {
    if (this.phase !== 'betting') throw new BlackjackError('现在不能发牌');
    if (!this.hasBets()) throw new BlackjackError('还没有人下注');
    this.setPhase('dealing');
    const active = this.players.filter((p) => p.bet > 0);
    for (const p of active) p.hands = [this.newHand(p, p.bet)];
    for (let round = 0; round < 2; round++) {
      this.giveDealer(round === 1);
      for (const p of active) this.giveHand(p, p.hands[0], 'deal');
    }
    for (const p of active) {
      if (evaluateBlackjack(p.hands[0].cards).blackjack) {
        p.hands[0].done = true;
        this.emit({ type: 'blackjack', playerId: p.id, handId: p.hands[0].id });
      }
    }
  }

  /** 庄家明牌是 A 或 10 点时先看暗牌：已经是黑杰克就直接翻开，玩家不会在注定输的牌上加倍 / 分牌 */
  private dealerHasNatural(): boolean {
    return evaluateBlackjack(this.dealer).blackjack;
  }

  /** 发牌动画结束：进入玩家行动（或直接轮到庄家） */
  beginTurns() {
    if (this.phase !== 'dealing') throw new BlackjackError('现在不能执行这个操作');
    const up = this.dealer[0];
    if ((isAce(up) || isTenValue(up)) && this.dealerHasNatural()) return this.toDealer();
    const first = this.nextTurn(-1);
    if (!first) return this.toDealer();
    this.setPhase('player-turn');
    this.setTurn(first.p, first.h);
  }

  private toDealer() {
    this.current = null;
    this.token++;
    this.setPhase('dealer-turn');
  }

  private setTurn(p: BjPlayer, h: BjHand) {
    p.activeHand = p.hands.indexOf(h);
    this.current = { playerId: p.id, handId: h.id };
    this.token++;
    this.emit({ type: 'turn', playerId: p.id, handId: h.id });
  }

  /** 从第 from 位玩家之后，找下一手还能行动的牌 */
  private nextTurn(from: number): { p: BjPlayer; h: BjHand } | null {
    for (let i = from + 1; i < this.players.length; i++) {
      const h = this.players[i].hands.find((x) => !x.done);
      if (h) return { p: this.players[i], h };
    }
    return null;
  }

  private advanceTurn() {
    const i = this.players.findIndex((p) => p.id === this.current?.playerId);
    const p = this.players[i];
    const own = p?.hands.find((h) => !h.done);
    if (p && own) return this.setTurn(p, own);
    const next = this.nextTurn(i);
    if (next) return this.setTurn(next.p, next.h);
    this.toDealer();
  }

  // ───────────── 玩家行动 ─────────────

  private currentHand(): { p: BjPlayer; h: BjHand } | null {
    if (this.phase !== 'player-turn' || !this.current) return null;
    const p = this.getPlayer(this.current.playerId);
    const h = p?.hands.find((x) => x.id === this.current!.handId);
    return p && h ? { p, h } : null;
  }

  getLegal(id: string): BjLegal | null {
    const c = this.currentHand();
    if (!c || c.p.id !== id || c.h.done) return null;
    const { p, h } = c;
    const two = h.cards.length === 2;
    const same = two && h.cards[0].rank === h.cards[1].rank;
    const afford = p.balance >= h.bet;
    return {
      hit: true,
      stand: true,
      double: two && afford && !h.fromSplit,
      split: same && afford && !h.fromSplit && p.hands.length < this.rules.maxHands,
      cost: h.bet,
    };
  }

  act(id: string, type: BjAction, token?: number) {
    if (this.phase !== 'player-turn') throw new BlackjackError('现在不能执行这个操作');
    this.need(id);
    if (this.current?.playerId !== id) throw new BlackjackError('还没轮到你');
    if (token !== undefined && token !== this.token) throw new BlackjackError('这个操作已经处理过了');
    const c = this.currentHand();
    const legal = this.getLegal(id);
    if (!c || !legal) throw new BlackjackError('现在不能执行这个操作');
    const { p, h } = c;
    switch (type) {
      case 'hit':
        this.emit({ type: 'hit', playerId: id, handId: h.id });
        this.giveHand(p, h, 'hit');
        this.token++;
        this.afterCard(p, h);
        return;
      case 'stand':
        this.finishHand(p, h, false);
        return;
      case 'double':
        if (!legal.double) throw new BlackjackError(p.balance < h.bet ? '金币不足' : '现在不能加倍');
        p.balance -= h.bet;
        this.emit({ type: 'double', playerId: id, handId: h.id, added: h.bet });
        h.bet *= 2;
        h.doubled = true;
        this.giveHand(p, h, 'double');
        this.token++;
        if (evaluateBlackjack(h.cards, h.fromSplit).bust) this.emit({ type: 'bust', playerId: id, handId: h.id });
        else this.emit({ type: 'stand', playerId: id, handId: h.id, auto: true });
        h.done = true;
        this.advanceTurn();
        return;
      case 'split': {
        if (!legal.split) throw new BlackjackError(p.balance < h.bet ? '金币不足' : '现在不能分牌');
        const aces = isAce(h.cards[0]);
        p.balance -= h.bet;
        const moved = h.cards.pop()!;
        h.fromSplit = true;
        const b = this.newHand(p, h.bet, [moved], true);
        p.hands.splice(p.hands.indexOf(h) + 1, 0, b);
        this.emit({ type: 'split', playerId: id, handId: h.id, newHandId: b.id, added: h.bet });
        this.giveHand(p, h, 'split');
        this.giveHand(p, b, 'split');
        this.token++;
        for (const x of [h, b]) {
          // 分 A：每手只补一张；补成 21 点：自动停牌
          if (aces || evaluateBlackjack(x.cards, true).value === 21) {
            x.done = true;
            this.emit({ type: 'stand', playerId: id, handId: x.id, auto: true });
          }
        }
        if (h.done) this.advanceTurn();
        return;
      }
      default:
        throw new BlackjackError('未知操作');
    }
  }

  private afterCard(p: BjPlayer, h: BjHand) {
    const v = evaluateBlackjack(h.cards, h.fromSplit);
    if (v.bust) {
      h.done = true;
      this.emit({ type: 'bust', playerId: p.id, handId: h.id });
      this.advanceTurn();
    } else if (v.value === 21) this.finishHand(p, h, true);
  }

  private finishHand(p: BjPlayer, h: BjHand, auto: boolean) {
    h.done = true;
    this.emit({ type: 'stand', playerId: p.id, handId: h.id, auto });
    this.advanceTurn();
  }

  /** 行动超时：当前这一手自动停牌 */
  autoStand(id: string) {
    const c = this.currentHand();
    if (!c || c.p.id !== id) return;
    this.finishHand(c.p, c.h, true);
  }

  // ───────────── 庄家（固定规则，没有随机） ─────────────

  /** 庄家是否必须要牌：不足 17 要牌；17 及以上（含软 17）停牌 */
  dealerMustHit(): boolean {
    return evaluateBlackjack(this.dealer).value < 17;
  }

  /** 还有没有需要与庄家比大小的手牌（全部爆牌 / 黑杰克 / 离桌时庄家只翻牌，不补牌） */
  private hasLiveHands(): boolean {
    return this.players.some((p) => p.hands.some((h) => !h.forfeited && !evaluateBlackjack(h.cards, h.fromSplit).bust && !evaluateBlackjack(h.cards, h.fromSplit).blackjack));
  }

  /** 庄家走一步：翻暗牌 → 逐张补牌 → 停牌并结算。返回是否已经结算 */
  dealerStep(): boolean {
    if (this.phase !== 'dealer-turn') throw new BlackjackError('现在不是庄家的回合');
    if (!this.holeRevealed) {
      this.holeRevealed = true;
      this.emit({ type: 'dealerReveal', card: this.dealer[1] });
      if (this.dealerHasNatural()) this.emit({ type: 'dealerBlackjack' });
      return false;
    }
    if (this.hasLiveHands() && !this.dealerHasNatural() && this.dealerMustHit()) {
      this.giveDealer(false);
      const v = evaluateBlackjack(this.dealer);
      if (v.bust) this.emit({ type: 'dealerBust', value: v.value });
      return false;
    }
    const v = evaluateBlackjack(this.dealer);
    if (!v.bust && !v.blackjack && this.hasLiveHands()) this.emit({ type: 'dealerStand', value: v.value });
    this.resolve();
    return true;
  }

  // ───────────── 结算 ─────────────

  private resultOf(h: BjHand): HandResult {
    if (h.forfeited) return 'forfeit';
    const me = evaluateBlackjack(h.cards, h.fromSplit);
    const d = evaluateBlackjack(this.dealer);
    if (me.bust) return 'bust';
    if (me.blackjack) return d.blackjack ? 'push' : 'blackjack';
    if (d.blackjack) return 'dealer-blackjack';
    if (d.bust || me.value > d.value) return 'win';
    return me.value === d.value ? 'push' : 'lose';
  }

  /** 结果立即确定并派彩；画面上的演出在这之后播放，跳过演出不影响任何数字 */
  private resolve() {
    this.setPhase('resolution');
    const outcomes: { playerId: string; hands: { handId: string; result: HandResult; bet: number; payout: number }[] }[] = [];
    for (const p of this.players) {
      if (!p.hands.length) continue;
      for (const h of p.hands) {
        h.result = this.resultOf(h);
        h.payout = payoutFor(h.bet, h.result, this.rules);
      }
      outcomes.push({ playerId: p.id, hands: p.hands.map((h) => ({ handId: h.id, result: h.result!, bet: h.bet, payout: h.payout })) });
    }
    this.emit({ type: 'resolved', roundId: this.roundId, outcomes });
    this.setPhase('payout');
    for (const p of this.players) {
      if (!p.hands.length) continue;
      const amount = p.hands.reduce((s, h) => s + h.payout, 0);
      const bet = p.hands.reduce((s, h) => s + h.bet, 0);
      if (!p.left) p.balance += amount;
      p.bet = 0;
      this.emit({ type: 'payout', playerId: p.id, amount, profit: amount - bet });
    }
    this.setPhase('round-end');
    this.emit({ type: 'roundEnd', roundId: this.roundId });
  }

  /** 一名玩家这一局的结算事实（还没结算 / 没有参加时为 null） */
  factsOf(id: string): BjRoundFacts | null {
    const p = this.getPlayer(id);
    if (!p || this.phase !== 'round-end' || !p.hands.length || p.hands.some((h) => !h.result)) return null;
    const bet = p.hands.reduce((s, h) => s + h.bet, 0);
    const payout = p.hands.reduce((s, h) => s + h.payout, 0);
    return {
      roundId: this.roundId,
      bet,
      payout,
      profit: payout - bet,
      hands: p.hands.map((h) => ({ result: h.result!, value: evaluateBlackjack(h.cards, h.fromSplit).value, cards: h.cards.length, doubled: h.doubled, fromSplit: h.fromSplit })),
      dealerBust: evaluateBlackjack(this.dealer).bust,
    };
  }

  /** 校验：全桌筹码（手里 + 桌上下注）。测试用 */
  chipsOnTable(): number {
    const live = this.phase !== 'round-end' && this.phase !== 'idle';
    return this.players.reduce((s, p) => s + p.balance + (live ? (p.hands.length ? p.hands.reduce((a, h) => a + h.bet, 0) : p.bet) : 0), 0);
  }
}
