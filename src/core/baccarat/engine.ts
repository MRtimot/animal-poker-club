// 百家乐引擎：权威规则与状态机（纯逻辑，不含计时器 / 网络 / 界面）。
// 停止下注时按发牌顺序与补牌表一次发好整局的牌（结果在这一刻就确定了），之后只是按顺序逐张公开。
// 没公开的牌不会出现在任何事件或视图里；牌靴的顺序永远不离开引擎。
import { cryptoRandom, randomId, type RNG } from '../utils/random';
import {
  BAC_SPOTS,
  NO_BETS,
  bacBetError,
  bacCardValue,
  bacScore,
  betTotal,
  cleanBacRules,
  cleanBets,
  dealCoup,
  isNatural,
  spotPayout,
  winnerOf,
  type BacBets,
  type BacWinner,
  type BaccaratRules,
} from './rules';
import { BacShoe, type BacCard, type BacShoeState } from './shoe';
import { BAC_TRANSITIONS, type BacEvent, type BacEventBody, type BacHistoryEntry, type BacPlayer, type BacRoundFacts, type BacSide, type BaccaratPhase } from './types';

export class BaccaratError extends Error {}

export const MAX_BAC_PLAYERS = 6;
const HISTORY = 60;

interface RevealStep {
  side: BacSide;
  index: number;
}

export interface BaccaratEngineState {
  rules: BaccaratRules;
  phase: BaccaratPhase;
  round: number;
  roundId: string;
  players: BacPlayer[];
  /** 这一局的全部牌（停止下注时发好；只在服务器 / 本地主机里） */
  coup: Record<BacSide, BacCard[]>;
  /** 已经公开了几张（按 plan 的顺序） */
  revealed: number;
  plan: RevealStep[];
  winner: BacWinner | null;
  history: BacHistoryEntry[];
  events: BacEvent[];
  seq: number;
  shoe: BacShoeState;
}

/** 公开顺序：闲 1、闲 2、庄 1、庄 2，然后闲的第三张、庄的第三张（发牌本身按 闲、庄、闲、庄 的标准顺序） */
function revealPlan(coup: Record<BacSide, BacCard[]>): RevealStep[] {
  const steps: RevealStep[] = [
    { side: 'player', index: 0 },
    { side: 'player', index: 1 },
    { side: 'banker', index: 0 },
    { side: 'banker', index: 1 },
  ];
  if (coup.player.length > 2) steps.push({ side: 'player', index: 2 });
  if (coup.banker.length > 2) steps.push({ side: 'banker', index: 2 });
  return steps;
}

export class BaccaratEngine {
  readonly rules: BaccaratRules;
  phase: BaccaratPhase = 'idle';
  round = 0;
  roundId = '';
  players: BacPlayer[] = [];
  coup: Record<BacSide, BacCard[]> = { player: [], banker: [] };
  revealed = 0;
  plan: RevealStep[] = [];
  winner: BacWinner | null = null;
  history: BacHistoryEntry[] = [];
  events: BacEvent[] = [];
  private seq = 0;
  private shoe: BacShoe;

  constructor(rules?: Partial<BaccaratRules>, rng: RNG = cryptoRandom) {
    this.rules = cleanBacRules(rules);
    this.shoe = new BacShoe(this.rules.decks, rng);
  }

  // ───────────── 保存 / 恢复 ─────────────

  toState(): BaccaratEngineState {
    return {
      rules: this.rules,
      phase: this.phase,
      round: this.round,
      roundId: this.roundId,
      players: this.players,
      coup: this.coup,
      revealed: this.revealed,
      plan: this.plan,
      winner: this.winner,
      history: this.history,
      events: this.events,
      seq: this.seq,
      shoe: this.shoe.toState(),
    };
  }

  static fromState(s: BaccaratEngineState, rng: RNG = cryptoRandom): BaccaratEngine {
    const e = new BaccaratEngine(s.rules, rng);
    e.phase = s.phase;
    e.round = s.round;
    e.roundId = s.roundId;
    e.players = s.players;
    e.coup = s.coup;
    e.revealed = s.revealed;
    e.plan = s.plan;
    e.winner = s.winner;
    e.history = s.history;
    e.events = s.events;
    e.seq = s.seq;
    e.shoe = BacShoe.fromState(s.shoe, rng);
    return e;
  }

  get shoeInfo() {
    return { remaining: this.shoe.remaining, size: this.shoe.size, decks: this.shoe.decks, shoeId: this.shoe.shoeId };
  }

  // ───────────── 基础 ─────────────

  private setPhase(to: BaccaratPhase) {
    if (!BAC_TRANSITIONS[this.phase].includes(to)) throw new BaccaratError(`非法的阶段跳转：${this.phase} → ${to}`);
    this.phase = to;
  }

  private emit(e: BacEventBody) {
    this.events.push({ ...e, seq: ++this.seq } as BacEvent);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  getPlayer(id: string): BacPlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  private need(id: string): BacPlayer {
    const p = this.getPlayer(id);
    if (!p) throw new BaccaratError('你不在这张牌桌上');
    return p;
  }

  /** 一局正在进行（已经停止下注，还没派彩完） */
  inRound(): boolean {
    return this.phase === 'closed' || this.phase === 'dealing' || this.phase === 'result' || this.phase === 'payout';
  }

  addPlayer(id: string, name: string, balance: number): BacPlayer {
    if (this.getPlayer(id)) throw new BaccaratError('玩家已在桌上');
    if (this.players.length >= MAX_BAC_PLAYERS) throw new BaccaratError('牌桌已满');
    let seat = 0;
    while (this.players.some((p) => p.seat === seat)) seat++;
    const p: BacPlayer = { id, name, seat, balance: Math.max(0, Math.floor(balance)), bets: { ...NO_BETS }, placed: false, skipped: false, left: false, returns: { ...NO_BETS } };
    this.players.push(p);
    this.players.sort((a, b) => a.seat - b.seat);
    return p;
  }

  /** 玩家离开：下注阶段退回下注；一局进行中下注照常结算（结果早已确定，离开不能改变它） */
  removePlayer(id: string) {
    const p = this.getPlayer(id);
    if (!p || p.left) return;
    this.emit({ type: 'left', playerId: id });
    if (!this.inRound() || !p.placed) {
      if (this.phase === 'betting') p.balance += betTotal(p.bets);
      this.players = this.players.filter((x) => x.id !== id);
      return;
    }
    p.left = true;
  }

  /** 校正手里的筹码（持久金币在别处变化）：只能在还没下注时 */
  setBalance(id: string, balance: number) {
    const p = this.getPlayer(id);
    if (!p || this.inRound() || p.placed) return;
    p.balance = Math.max(0, Math.floor(balance));
  }

  // ───────────── 下注 ─────────────

  openBetting(roundId = `baccarat-round-${randomId(12)}`) {
    this.setPhase('betting');
    this.players = this.players.filter((p) => !p.left);
    this.round++;
    this.roundId = roundId;
    this.events = [];
    this.coup = { player: [], banker: [] };
    this.revealed = 0;
    this.plan = [];
    this.winner = null;
    for (const p of this.players) {
      p.bets = { ...NO_BETS };
      p.returns = { ...NO_BETS };
      p.placed = false;
      p.skipped = false;
    }
    // 到了切牌位置：换新牌靴（一局中途绝不洗牌）
    if (this.shoe.beginRound(this.rules.reshuffleAt)) this.emit({ type: 'shuffle', shoeId: this.shoe.shoeId });
    this.emit({ type: 'roundStart', round: this.round, roundId });
  }

  canBet(p: BacPlayer): boolean {
    return !p.left && p.balance + betTotal(p.bets) >= this.rules.minBet;
  }

  /** 确认下注（每局一次，三个区一起确认；之后不能修改） */
  placeBet(id: string, bets: unknown) {
    if (this.phase !== 'betting') throw new BaccaratError('已经停止下注');
    const p = this.need(id);
    if (p.placed) throw new BaccaratError('你已经下注了');
    const err = bacBetError(bets, p.balance, this.rules);
    if (err) throw new BaccaratError(err);
    const b = cleanBets(bets as Partial<BacBets>);
    p.balance -= betTotal(b);
    p.bets = b;
    p.placed = true;
    p.skipped = false;
    this.emit({ type: 'bet', playerId: id, bets: { ...b } });
  }

  skipBet(id: string) {
    if (this.phase !== 'betting') throw new BaccaratError('已经停止下注');
    const p = this.need(id);
    if (p.placed) throw new BaccaratError('你已经下注了');
    if (p.skipped) return;
    p.skipped = true;
    this.emit({ type: 'skip', playerId: id });
  }

  hasBets(): boolean {
    return this.players.some((p) => p.placed);
  }

  // ───────────── 发牌与开牌 ─────────────

  /** 停止下注：按标准顺序与补牌表发好整局的牌（还没有公开任何一张） */
  closeBetting() {
    if (this.phase !== 'betting') throw new BaccaratError('现在不能停止下注');
    if (!this.hasBets()) throw new BaccaratError('还没有人下注');
    this.setPhase('closed');
    this.coup = dealCoup(() => this.shoe.draw());
    this.plan = revealPlan(this.coup);
    this.revealed = 0;
    this.emit({ type: 'closed' });
  }

  /** 还有没公开的牌 */
  hasMoreCards(): boolean {
    return this.revealed < this.plan.length;
  }

  /** 公开下一张牌，以及此时已经可以公开的补牌决定 */
  revealNext() {
    if (this.phase === 'closed') this.setPhase('dealing');
    if (this.phase !== 'dealing' || !this.hasMoreCards()) throw new BaccaratError('现在不能开牌');
    const step = this.plan[this.revealed++];
    const card = this.coup[step.side][step.index];
    this.emit({ type: 'card', side: step.side, index: step.index, card, third: step.index === 2 });
    const p2 = this.coup.player.slice(0, 2);
    const b2 = this.coup.banker.slice(0, 2);
    if (this.revealed === 4) {
      const pn = isNatural(p2);
      const bn = isNatural(b2);
      if (pn || bn) {
        this.emit({ type: 'natural', side: pn && bn ? 'both' : pn ? 'player' : 'banker', score: Math.max(pn ? bacScore(p2) : 0, bn ? bacScore(b2) : 0) });
        return;
      }
      const pDraws = this.coup.player.length > 2;
      this.emit({ type: 'rule', side: 'player', action: pDraws ? 'draw' : 'stand', total: bacScore(p2) });
      // 闲家停牌：庄家的决定此时已经可以公开（只看庄家两张）
      if (!pDraws) this.emit({ type: 'rule', side: 'banker', action: this.coup.banker.length > 2 ? 'draw' : 'stand', total: bacScore(b2) });
    } else if (step.side === 'player' && step.index === 2) {
      // 闲家的第三张公开之后，庄家按补牌表决定
      this.emit({ type: 'rule', side: 'banker', action: this.coup.banker.length > 2 ? 'draw' : 'stand', total: bacScore(b2) });
    }
  }

  // ───────────── 结算 ─────────────

  /** 全部公开后结算：结果立即确定并派彩；画面上的演出在这之后播放，跳过演出不影响任何数字 */
  resolve() {
    if (this.phase !== 'dealing' || this.hasMoreCards()) throw new BaccaratError('还有牌没有公开');
    this.setPhase('result');
    const ps = bacScore(this.coup.player);
    const bs = bacScore(this.coup.banker);
    const winner = winnerOf(ps, bs);
    this.winner = winner;
    const outcomes: { playerId: string; bets: BacBets; returns: BacBets }[] = [];
    for (const p of this.players) {
      if (!p.placed) continue;
      p.returns = { player: spotPayout('player', p.bets.player, winner, this.rules), banker: spotPayout('banker', p.bets.banker, winner, this.rules), tie: spotPayout('tie', p.bets.tie, winner, this.rules) };
      outcomes.push({ playerId: p.id, bets: { ...p.bets }, returns: { ...p.returns } });
    }
    this.emit({ type: 'result', roundId: this.roundId, winner, player: ps, banker: bs, outcomes });
    this.setPhase('payout');
    for (const p of this.players) {
      if (!p.placed) continue;
      const amount = betTotal(p.returns);
      if (!p.left) p.balance += amount;
      this.emit({ type: 'payout', playerId: p.id, amount, profit: amount - betTotal(p.bets) });
    }
    this.history.push({ round: this.round, winner, player: ps, banker: bs, natural: isNatural(this.coup.player.slice(0, 2)) || isNatural(this.coup.banker.slice(0, 2)) });
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
    this.setPhase('round-end');
    this.emit({ type: 'roundEnd', roundId: this.roundId });
  }

  /**
   * 一名玩家这一局的结算事实。结果在停止下注时就确定了，所以一局中途（例如离开牌桌）也可以按真实结果计算，
   * 不会因为离开而逃掉输的注或拿不到赢的钱。没有下注 / 还没停止下注时为 null。
   */
  factsOf(id: string): BacRoundFacts | null {
    const p = this.getPlayer(id);
    if (!p || !p.placed || (!this.inRound() && this.phase !== 'round-end') || this.coup.player.length < 2) return null;
    const ps = bacScore(this.coup.player);
    const bs = bacScore(this.coup.banker);
    const winner = winnerOf(ps, bs);
    const returns: BacBets = { player: spotPayout('player', p.bets.player, winner, this.rules), banker: spotPayout('banker', p.bets.banker, winner, this.rules), tie: spotPayout('tie', p.bets.tie, winner, this.rules) };
    const bet = betTotal(p.bets);
    const payout = betTotal(returns);
    return {
      roundId: this.roundId,
      bets: { ...p.bets },
      returns,
      bet,
      payout,
      profit: payout - bet,
      winner,
      playerScore: ps,
      bankerScore: bs,
      natural: isNatural(this.coup.player.slice(0, 2)) || isNatural(this.coup.banker.slice(0, 2)),
    };
  }

  /** 公开了的牌（视图只用这些） */
  visible(side: BacSide): BacCard[] {
    const out: BacCard[] = [];
    for (let i = 0; i < this.revealed; i++) {
      const s = this.plan[i];
      if (s.side === side) out[s.index] = this.coup[side][s.index];
    }
    return out.filter(Boolean);
  }

  /** 校验：全桌筹码（手里 + 桌上下注）。测试用 */
  chipsOnTable(): number {
    const live = this.phase !== 'round-end' && this.phase !== 'idle';
    return this.players.reduce((s, p) => s + p.balance + (live ? betTotal(p.bets) : 0), 0);
  }
}

export { BAC_SPOTS, bacCardValue };
