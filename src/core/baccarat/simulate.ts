// 百家乐公平性模拟（开发 / 测试用）：用真正的引擎与加密安全随机数打很多局，独立核对每一局，并统计频率。
// 统计只是结果，不会回头影响发牌（引擎读不到这里的任何数字）。
import { RANKS, SUITS } from '../cards/card';
import { validCard, duplicateCards } from '../blackjack/audit';
import { cryptoRandom, type RNG } from '../utils/random';
import { expectedCardCounts, expectedReturns, expectedWinner } from './audit';
import { BaccaratEngine } from './engine';
import { betTotal, type BacWinner } from './rules';
import type { BacCard } from './shoe';

export interface BacSimReport {
  rounds: number;
  cardsDealt: number;
  shoes: number;
  /** 初始四张（位置固定，与任何决定无关）的点数 / 花色卡方：自由度 12 / 3 */
  chiRank: number;
  chiSuit: number;
  rank: Record<string, number>;
  outcome: Record<BacWinner, number>;
  natural: number;
  playerThird: number;
  bankerThird: number;
  /** 每个下注区每押 1 平均返还多少（含本金）；庄家优势 = 1 − 返还 */
  returnBySpot: Record<'player' | 'banker' | 'tie', number>;
  houseEdge: Record<'player' | 'banker' | 'tie', number>;
  problems: string[];
  problemCount: number;
}

/** 卡方临界值（p = 0.001） */
export const BAC_CHI_LIMIT = { rank: 32.91, suit: 16.27 } as const;

/** 理论值（8 副牌，标准规则）：只用来对照，不是目标，引擎不会读取 */
export const BAC_THEORY = { player: 0.4462, banker: 0.4586, tie: 0.0952, edge: { player: 0.0124, banker: 0.0106, tie: 0.1436 } } as const;

const RANK_NAME: Record<number, string> = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function chi(observed: readonly number[]): number {
  const total = observed.reduce((s, x) => s + x, 0);
  const e = total / observed.length;
  return observed.reduce((s, x) => s + (x - e) ** 2 / e, 0);
}

export function simulateBaccarat(o: { rounds: number; rng?: RNG; bet?: number }): BacSimReport {
  const bet = o.bet ?? 100;
  const e = new BaccaratEngine({ minBet: 1, maxBet: 1_000_000 }, o.rng ?? cryptoRandom);
  // 三位玩家各押一个区：同一副牌、同一个结果，各自结算
  const spots = ['player', 'banker', 'tie'] as const;
  for (const s of spots) e.addPlayer(s, s, 1e12);
  const rank = new Array(15).fill(0);
  const suit: Record<string, number> = Object.fromEntries(SUITS.map((s) => [s, 0]));
  const outcome: Record<BacWinner, number> = { player: 0, banker: 0, tie: 0 };
  const returned = { player: 0, banker: 0, tie: 0 };
  const problems: string[] = [];
  let problemCount = 0;
  const flag = (r: number, msg: string) => {
    problemCount++;
    if (problems.length < 20) problems.push(`第 ${r} 局：${msg}`);
  };
  let cards = 0, initial = 0, shoes = 1, natural = 0, pThird = 0, bThird = 0;
  let inShoe = new Set<string>();

  for (let r = 1; r <= o.rounds; r++) {
    e.openBetting();
    if (e.events.some((x) => x.type === 'shuffle')) {
      shoes++;
      inShoe = new Set();
    }
    const before = new Map(e.players.map((p) => [p.id, p.balance]));
    for (const s of spots) e.placeBet(s, { [s]: bet });
    e.closeBetting();
    let guard = 0;
    while (e.hasMoreCards() && guard++ < 10) e.revealNext();
    e.resolve();
    const all: BacCard[] = [...e.coup.player, ...e.coup.banker];
    for (const c of all) if (!validCard(c)) flag(r, `无效的牌 ${JSON.stringify(c)}`);
    const dup = duplicateCards(all.map((c) => c.uid));
    if (dup.length) flag(r, `同一局重复的实体牌 ${dup.join(',')}`);
    for (const c of all) {
      if (inShoe.has(c.uid)) flag(r, `同一牌靴里发出了两次 ${c.uid}`);
      inShoe.add(c.uid);
    }
    cards += all.length;
    for (const c of [e.coup.player[0], e.coup.player[1], e.coup.banker[0], e.coup.banker[1]]) {
      rank[c.rank]++;
      suit[c.suit]++;
      initial++;
    }
    // 补牌、例牌、结果：按标准表独立推算
    const want = expectedCardCounts(e.coup.player, e.coup.banker);
    if (want.player !== e.coup.player.length || want.banker !== e.coup.banker.length) flag(r, `补牌不对：应为 闲 ${want.player} 张 / 庄 ${want.banker} 张`);
    if (e.coup.player.length === 2 && e.coup.banker.length === 2 && e.events.some((x) => x.type === 'natural')) natural++;
    if (e.coup.player.length === 3) pThird++;
    if (e.coup.banker.length === 3) bThird++;
    const w = expectedWinner(e.coup.player, e.coup.banker);
    if (w !== e.winner) flag(r, `结果应为 ${w}，引擎给了 ${e.winner}`);
    outcome[w]++;
    // 赔付、派彩次数、余额守恒
    for (const p of e.players) {
      const exp = expectedReturns(p.bets, w);
      if (JSON.stringify(exp) !== JSON.stringify(p.returns)) flag(r, `${p.id} 赔付应为 ${JSON.stringify(exp)}，引擎给了 ${JSON.stringify(p.returns)}`);
      const n = e.events.filter((x) => x.type === 'payout' && x.playerId === p.id).length;
      if (n !== 1) flag(r, `${p.id} 派彩 ${n} 次`);
      if (p.balance !== before.get(p.id)! - betTotal(p.bets) + betTotal(p.returns)) flag(r, `${p.id} 余额不守恒`);
      if (p.balance < 0) flag(r, `${p.id} 余额为负`);
      returned[p.id as keyof typeof returned] += betTotal(p.returns);
    }
  }
  const staked = o.rounds * bet;
  const ret = { player: returned.player / staked, banker: returned.banker / staked, tie: returned.tie / staked };
  return {
    rounds: o.rounds,
    cardsDealt: cards,
    shoes,
    chiRank: chi(RANKS.map((x) => rank[x])),
    chiSuit: chi(SUITS.map((s) => suit[s])),
    rank: Object.fromEntries(RANKS.map((x) => [RANK_NAME[x] ?? String(x), rank[x] / initial])),
    outcome: { player: outcome.player / o.rounds, banker: outcome.banker / o.rounds, tie: outcome.tie / o.rounds },
    natural: natural / o.rounds,
    playerThird: pThird / o.rounds,
    bankerThird: bThird / o.rounds,
    returnBySpot: ret,
    houseEdge: { player: 1 - ret.player, banker: 1 - ret.banker, tie: 1 - ret.tie },
    problems,
    problemCount,
  };
}

export function formatBacReport(r: BacSimReport): string {
  const p = (x: number) => (x * 100).toFixed(2) + '%';
  return [
    `局数 ${r.rounds.toLocaleString()} · 发出 ${r.cardsDealt.toLocaleString()} 张牌 · 用了 ${r.shoes} 个牌靴`,
    `初始四张的点数频率（理论每种 7.69%）：` + Object.entries(r.rank).map(([k, v]) => `${k} ${p(v)}`).join('  '),
    `卡方（初始四张）：点数 ${r.chiRank.toFixed(2)}（临界 ${BAC_CHI_LIMIT.rank}）· 花色 ${r.chiSuit.toFixed(2)}（临界 ${BAC_CHI_LIMIT.suit}）`,
    `结果：闲 ${p(r.outcome.player)}（理论 ${p(BAC_THEORY.player)}）· 庄 ${p(r.outcome.banker)}（理论 ${p(BAC_THEORY.banker)}）· 和 ${p(r.outcome.tie)}（理论 ${p(BAC_THEORY.tie)}）`,
    `例牌 ${p(r.natural)} · 闲补第三张 ${p(r.playerThird)} · 庄补第三张 ${p(r.bankerThird)}`,
    `每押 1 平均返还：闲 ${r.returnBySpot.player.toFixed(4)} · 庄 ${r.returnBySpot.banker.toFixed(4)} · 和 ${r.returnBySpot.tie.toFixed(4)}`,
    `庄家优势：闲 ${p(r.houseEdge.player)}（理论 ${p(BAC_THEORY.edge.player)}）· 庄 ${p(r.houseEdge.banker)}（理论 ${p(BAC_THEORY.edge.banker)}）· 和 ${p(r.houseEdge.tie)}（理论 ${p(BAC_THEORY.edge.tie)}）`,
    r.problemCount ? `发现 ${r.problemCount} 个问题：\n  ` + r.problems.join('\n  ') : '没有发现任何问题：没有重复 / 无效的牌、错误的补牌、错误的结果或赔付、重复或漏掉的派彩、负余额',
  ].join('\n');
}
