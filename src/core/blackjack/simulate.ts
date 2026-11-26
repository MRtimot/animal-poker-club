// 21 点公平性模拟（开发 / 测试用）：用真正的引擎与加密安全随机数打很多局，独立核对每一局，并统计频率。
// 统计只是结果，不会回头影响发牌（引擎根本读不到这里的任何数字）。
import { RANKS, SUITS } from '../cards/card';
import { cryptoRandom, type RNG } from '../utils/random';
import { dealerRuleProblem, duplicateCards, expectedPayout, expectedResult, handProblem, validCard } from './audit';
import { BlackjackEngine } from './engine';
import { evaluateBlackjack } from './hand';
import { basicStrategy } from './strategy';
import type { BjCard } from './shoe';

export interface SimOptions {
  rounds: number;
  /** 同桌几位玩家（1 ~ 6），全部按基本策略 */
  players?: number;
  bet?: number;
  rng?: RNG;
}

export interface SimReport {
  rounds: number;
  hands: number;
  cardsDealt: number;
  /** 全部发出的牌的点数 / 花色频率（参考：要牌与否取决于前面的牌，单副牌里会让后补的牌略偏大，这是数学上应有的，不是洗牌偏差） */
  rank: Record<string, number>;
  suit: Record<string, number>;
  /** 初始发牌（每人两张 + 庄家两张，位置固定、与任何决定无关）的点数频率 */
  dealRank: Record<string, number>;
  /** 卡方（只用初始发牌，检验洗牌本身）：点数（自由度 12）、花色（3）、庄家明牌的 52 张（51） */
  chiRank: number;
  chiSuit: number;
  chiUpCard: number;
  rate: {
    playerWin: number;
    dealerWin: number;
    push: number;
    blackjack: number;
    playerBust: number;
    dealerBust: number;
    double: number;
    split: number;
  };
  /** 每押 1 返还多少（含本金）；期望值 = 返还 − 1；庄家优势 = −期望值 */
  averageReturn: number;
  expectedValue: number;
  houseEdge: number;
  /** 发现的问题（应当为空） */
  problems: string[];
  problemCount: number;
}

const RANK_NAME: Record<number, string> = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function chi(observed: readonly number[]): number {
  const total = observed.reduce((s, x) => s + x, 0);
  const e = total / observed.length;
  return observed.reduce((s, x) => s + (x - e) ** 2 / e, 0);
}

export function simulate(o: SimOptions): SimReport {
  const players = Math.min(6, Math.max(1, Math.floor(o.players ?? 1)));
  const bet = o.bet ?? 10;
  const e = new BlackjackEngine({ minBet: 1, maxBet: 1_000_000 }, o.rng ?? cryptoRandom);
  for (let i = 0; i < players; i++) e.addPlayer('p' + i, 'P' + i, 1e12);
  const rank = new Array(15).fill(0);
  const dealRank = new Array(15).fill(0);
  const dealSuit: Record<string, number> = Object.fromEntries(SUITS.map((s) => [s, 0]));
  let dealt = 0;
  const suit: Record<string, number> = Object.fromEntries(SUITS.map((s) => [s, 0]));
  const up = new Array(52).fill(0);
  const problems: string[] = [];
  let problemCount = 0;
  const flag = (round: number, msg: string) => {
    problemCount++;
    if (problems.length < 20) problems.push(`第 ${round} 局：${msg}`);
  };
  let hands = 0, cards = 0, win = 0, lose = 0, push = 0, naturals = 0, busts = 0, dealerBusts = 0, doubles = 0, splits = 0, staked = 0, returned = 0;

  for (let r = 1; r <= o.rounds; r++) {
    e.openBetting();
    const before = new Map(e.players.map((p) => [p.id, p.balance]));
    for (const p of e.players) e.placeBet(p.id, bet);
    e.deal();
    e.beginTurns();
    for (let g = 0; e.phase === 'player-turn'; g++) {
      if (g > 60) {
        flag(r, '玩家回合卡住');
        break;
      }
      const id = e.current!.playerId;
      const legal = e.getLegal(id)!;
      const h = e.getPlayer(id)!.hands.find((x) => x.id === e.current!.handId)!;
      e.act(id, basicStrategy(h.cards, Math.min(11, e.dealer[0].rank === 14 ? 11 : Math.min(10, e.dealer[0].rank)), legal), e.token);
    }
    for (let g = 0; e.phase === 'dealer-turn' && g < 30; g++) e.dealerStep();
    if (e.phase !== 'round-end') {
      flag(r, `没有结束（${e.phase}）`);
      continue;
    }

    // 1) 牌：合法、唯一
    const all: BjCard[] = [...e.dealer, ...e.players.flatMap((p) => p.hands.flatMap((h) => h.cards))];
    for (const c of all) if (!validCard(c)) flag(r, `无效的牌 ${JSON.stringify(c)}`);
    const dup = duplicateCards(all.map((c) => c.uid));
    if (dup.length) flag(r, `重复的实体牌 ${dup.join(',')}`);
    cards += all.length;
    for (const c of all) {
      rank[c.rank]++;
      suit[c.suit]++;
    }
    // 初始发牌：庄家两张 + 每人第一手的前两张（分牌前的原始两张由第一张记录在两手里）
    const initial = [e.dealer[0], e.dealer[1], ...e.players.flatMap((p) => (p.hands.length > 1 ? [p.hands[0].cards[0], p.hands[1].cards[0]] : p.hands[0].cards.slice(0, 2)))];
    for (const c of initial) {
      dealRank[c.rank]++;
      dealSuit[c.suit]++;
      dealt++;
    }
    up[RANKS.indexOf(e.dealer[0].rank) + 13 * SUITS.indexOf(e.dealer[0].suit)]++;

    // 2) 庄家规则
    const live = e.players.some((p) => p.hands.some((h) => !evaluateBlackjack(h.cards, h.fromSplit).bust && !evaluateBlackjack(h.cards, h.fromSplit).blackjack));
    const dp = dealerRuleProblem(e.dealer, live);
    if (dp) flag(r, dp);
    const d = evaluateBlackjack(e.dealer);
    if (d.bust) dealerBusts++;

    // 3) 每一手：动作、结果、赔付；4) 余额：每人每局恰好派彩一次
    for (const p of e.players) {
      const payouts = e.events.filter((x) => x.type === 'payout' && x.playerId === p.id).length;
      if (payouts !== 1) flag(r, `${p.id} 派彩 ${payouts} 次`);
      let paid = 0, stake = 0;
      for (const h of p.hands) {
        hands++;
        const hp = handProblem(h, p.hands.length);
        if (hp) flag(r, hp);
        const want = expectedResult(h.cards, h.fromSplit, e.dealer);
        if (h.result !== want) flag(r, `结果应为 ${want}，引擎给了 ${h.result}`);
        if (h.payout !== expectedPayout(h.bet, want)) flag(r, `赔付应为 ${expectedPayout(h.bet, want)}，引擎给了 ${h.payout}`);
        if (h.bet !== bet * (h.doubled ? 2 : 1)) flag(r, `下注记录不对：${h.bet}`);
        paid += h.payout;
        stake += h.bet;
        if (h.result === 'win' || h.result === 'blackjack') win++;
        else if (h.result === 'push') push++;
        else lose++;
        if (h.result === 'blackjack') naturals++;
        if (h.result === 'bust') busts++;
        if (h.doubled) doubles++;
      }
      if (p.hands.length > 1) splits++;
      if (p.balance !== before.get(p.id)! - stake + paid) flag(r, `${p.id} 余额不守恒`);
      staked += stake;
      returned += paid;
    }
  }

  const averageReturn = staked ? returned / staked : 0;
  return {
    rounds: o.rounds,
    hands,
    cardsDealt: cards,
    rank: Object.fromEntries(RANKS.map((x) => [RANK_NAME[x] ?? String(x), rank[x] / cards])),
    suit: Object.fromEntries(SUITS.map((s) => [s, suit[s] / cards])),
    dealRank: Object.fromEntries(RANKS.map((x) => [RANK_NAME[x] ?? String(x), dealRank[x] / dealt])),
    chiRank: chi(RANKS.map((x) => dealRank[x])),
    chiSuit: chi(SUITS.map((s) => dealSuit[s])),
    chiUpCard: chi(up),
    rate: {
      playerWin: win / hands,
      dealerWin: lose / hands,
      push: push / hands,
      blackjack: naturals / hands,
      playerBust: busts / hands,
      dealerBust: dealerBusts / o.rounds,
      double: doubles / hands,
      split: splits / (o.rounds * players),
    },
    averageReturn,
    expectedValue: averageReturn - 1,
    houseEdge: 1 - averageReturn,
    problems,
    problemCount,
  };
}

/** 卡方临界值（p = 0.001）：超过才算“明显偏差”，正常随机波动远低于它 */
export const CHI_LIMIT = { rank: 32.91, suit: 16.27, upCard: 90.57 } as const;

/** 报告的文字版（命令行用） */
export function formatReport(r: SimReport): string {
  const p = (x: number) => (x * 100).toFixed(2) + '%';
  const lines = [
    `局数 ${r.rounds.toLocaleString()} · 手数 ${r.hands.toLocaleString()} · 发出 ${r.cardsDealt.toLocaleString()} 张牌`,
    `初始发牌的点数频率（理论每种 7.69%）：` + Object.entries(r.dealRank).map(([k, v]) => `${k} ${p(v)}`).join('  '),
    `全部发出的牌（参考，见说明）：` + Object.entries(r.rank).map(([k, v]) => `${k} ${p(v)}`).join('  '),
    `全部发出的牌的花色（理论各 25%）：` + Object.entries(r.suit).map(([k, v]) => `${k} ${p(v)}`).join('  '),
    `卡方（初始发牌）：点数 ${r.chiRank.toFixed(2)}（临界 ${CHI_LIMIT.rank}）· 花色 ${r.chiSuit.toFixed(2)}（临界 ${CHI_LIMIT.suit}）· 庄家明牌 52 张 ${r.chiUpCard.toFixed(2)}（临界 ${CHI_LIMIT.upCard}）`,
    `玩家赢 ${p(r.rate.playerWin)} · 庄家赢 ${p(r.rate.dealerWin)} · 平局 ${p(r.rate.push)}（按手）`,
    `黑杰克 ${p(r.rate.blackjack)} · 玩家爆牌 ${p(r.rate.playerBust)} · 庄家爆牌 ${p(r.rate.dealerBust)} · 加倍 ${p(r.rate.double)} · 分牌 ${p(r.rate.split)}`,
    `每押 1 平均返还 ${r.averageReturn.toFixed(4)} · 期望值 ${(r.expectedValue * 100).toFixed(2)}% · 庄家优势 ${(r.houseEdge * 100).toFixed(2)}%`,
    r.problemCount ? `发现 ${r.problemCount} 个问题：\n  ` + r.problems.join('\n  ') : '没有发现任何问题：没有重复 / 无效的牌、不可能的手牌、错误的赔付、违规的庄家或玩家动作、重复派彩',
  ];
  return lines.join('\n');
}
