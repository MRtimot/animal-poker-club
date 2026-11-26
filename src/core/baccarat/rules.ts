// 百家乐（Punto Banco）规则：点数、补牌表、赔付、下注校验（纯函数；服务器、本地、测试、模拟共用同一份）。
// 补牌完全由规则决定，没有任何随机或“AI 判断”。动物庄家的性格、玩家的下注与历史都不会影响这里的任何结果。
import type { Card } from '../cards/card';

export type BacSpot = 'player' | 'banker' | 'tie';
export const BAC_SPOTS: readonly BacSpot[] = ['player', 'banker', 'tie'];
export type BacBets = Record<BacSpot, number>;
export const NO_BETS: BacBets = { player: 0, banker: 0, tie: 0 };

export type BacWinner = 'player' | 'banker' | 'tie';

export const SPOT_NAME: Record<BacSpot, string> = { player: '闲', banker: '庄', tie: '和' };
export const SPOT_EN: Record<BacSpot, string> = { player: 'PLAYER', banker: 'BANKER', tie: 'TIE' };

export interface BaccaratRules {
  /** 牌靴里有几副牌 */
  decks: number;
  /** 剩余牌少于这个数时（切牌位置），下一局开始前换新牌靴并重新洗牌；一局中途不会洗牌 */
  reshuffleAt: number;
  minBet: number;
  maxBet: number;
  /** 庄赢抽水（百分比，整数） */
  bankerCommissionPct: number;
  /** 和局赔率 */
  tiePays: number;
}

/**
 * V1 锁定的规则：8 副牌，切牌位置剩 16 张；闲 1:1；庄 1:1 抽 5%；和 8:1；开和时押闲 / 庄的下注退回。
 * 没有边注（对子、龙宝等）。赔率与抽水任何配置都不能改变（cleanRules 只接受限额与牌靴参数）。
 */
export const DEFAULT_BAC_RULES: BaccaratRules = {
  decks: 8,
  reshuffleAt: 16,
  minBet: 10,
  maxBet: 1000,
  bankerCommissionPct: 5,
  tiePays: 8,
};

export interface BacTableTier {
  id: string;
  name: string;
  minBet: number;
  maxBet: number;
}

export const BAC_TIERS: readonly BacTableTier[] = [
  { id: 'low', name: '休闲桌', minBet: 10, maxBet: 500 },
  { id: 'mid', name: '俱乐部桌', minBet: 50, maxBet: 2000 },
  { id: 'high', name: '贵宾桌', minBet: 200, maxBet: 10000 },
];

export const bacTierById = (id: unknown): BacTableTier => BAC_TIERS.find((t) => t.id === id) ?? BAC_TIERS[0];

export function cleanBacRules(x: Partial<BaccaratRules> | null | undefined): BaccaratRules {
  const r = { ...DEFAULT_BAC_RULES, ...(x ?? {}) };
  const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d);
  const minBet = int(r.minBet, 1, 1_000_000, DEFAULT_BAC_RULES.minBet);
  return {
    decks: int(r.decks, 6, 8, DEFAULT_BAC_RULES.decks),
    // 一局最多用 6 张牌：切牌位置至少留 6 张，一局中途永远不会发完
    reshuffleAt: int(r.reshuffleAt, 6, 60, DEFAULT_BAC_RULES.reshuffleAt),
    minBet,
    maxBet: Math.max(minBet, int(r.maxBet, 1, 10_000_000, DEFAULT_BAC_RULES.maxBet)),
    bankerCommissionPct: DEFAULT_BAC_RULES.bankerCommissionPct,
    tiePays: DEFAULT_BAC_RULES.tiePays,
  };
}

// ───────────── 点数 ─────────────

/** 单张牌的点数：A = 1，2–9 按牌面，10 / J / Q / K = 0 */
export function bacCardValue(c: Pick<Card, 'rank'>): number {
  if (c.rank === 14) return 1;
  return c.rank >= 10 ? 0 : c.rank;
}

/** 一手的点数：总和只保留个位数 */
export function bacScore(cards: readonly Pick<Card, 'rank'>[]): number {
  return cards.reduce((s, c) => s + bacCardValue(c), 0) % 10;
}

/** 例牌：最初两张就是 8 或 9 */
export const isNatural = (cards: readonly Pick<Card, 'rank'>[]) => cards.length === 2 && bacScore(cards) >= 8;

// ───────────── 补牌（标准 Punto Banco） ─────────────

/** 闲家（前两张 total）：0–5 补牌，6–7 停牌（任何一方例牌时双方都不补，由调用者先判断） */
export const playerDraws = (total: number) => total <= 5;

/**
 * 庄家是否补第三张。playerThird：闲家第三张牌的点数（闲家没有补牌时为 null）。
 * 闲家没补：庄 0–5 补，6–7 停。
 * 闲家补了：庄 0–2 补；3 除非闲第三张是 8；4 闲第三张 2–7；5 闲第三张 4–7；6 闲第三张 6–7；7 停。
 */
export function bankerDraws(total: number, playerThird: number | null): boolean {
  if (playerThird === null) return total <= 5;
  switch (total) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return playerThird !== 8;
    case 4:
      return playerThird >= 2 && playerThird <= 7;
    case 5:
      return playerThird >= 4 && playerThird <= 7;
    case 6:
      return playerThird === 6 || playerThird === 7;
    default:
      return false;
  }
}

/**
 * 按发牌顺序得出整局的牌：闲 1、庄 1、闲 2、庄 2，然后按补牌表决定第三张。
 * draw：从牌靴顶上发一张。返回双方的牌（第三张存在时就是第三张）。
 */
export function dealCoup<C extends Pick<Card, 'rank'>>(draw: () => C): { player: C[]; banker: C[] } {
  const player = [draw()];
  const banker = [draw()];
  player.push(draw());
  banker.push(draw());
  if (isNatural(player) || isNatural(banker)) return { player, banker };
  let playerThird: number | null = null;
  if (playerDraws(bacScore(player))) {
    const c = draw();
    player.push(c);
    playerThird = bacCardValue(c);
  }
  if (bankerDraws(bacScore(banker), playerThird)) banker.push(draw());
  return { player, banker };
}

export function winnerOf(playerScore: number, bankerScore: number): BacWinner {
  return playerScore > bankerScore ? 'player' : bankerScore > playerScore ? 'banker' : 'tie';
}

// ───────────── 赔付 ─────────────

/**
 * 一个下注区这一局返还多少（含本金）。全部是整数：
 * 闲赢 1:1；庄赢 1:1 再抽 5%（盈利 = 下注 × 95%，向下取整）；和 8:1；开和时闲 / 庄退回本金；其余输掉。
 */
export function spotPayout(spot: BacSpot, amount: number, winner: BacWinner, r: Pick<BaccaratRules, 'bankerCommissionPct' | 'tiePays'> = DEFAULT_BAC_RULES): number {
  if (amount <= 0) return 0;
  if (spot === 'tie') return winner === 'tie' ? amount * (r.tiePays + 1) : 0;
  if (winner === 'tie') return amount;
  if (spot !== winner) return 0;
  if (spot === 'player') return amount * 2;
  return amount + Math.floor((amount * (100 - r.bankerCommissionPct)) / 100);
}

export function totalPayout(bets: BacBets, winner: BacWinner, r?: Pick<BaccaratRules, 'bankerCommissionPct' | 'tiePays'>): number {
  return spotPayout('player', bets.player, winner, r) + spotPayout('banker', bets.banker, winner, r) + spotPayout('tie', bets.tie, winner, r);
}

export const betTotal = (b: BacBets) => b.player + b.banker + b.tie;

/**
 * 下注是否合法：返回 null 表示可以下注，否则是给玩家看的原因。
 * 每个下注区要么不押，要么在限额内；总额不能超过余额；至少押一个区。
 */
export function bacBetError(bets: unknown, balance: number, r: Pick<BaccaratRules, 'minBet' | 'maxBet'>): string | null {
  if (!bets || typeof bets !== 'object') return '下注无效';
  const b = bets as Record<string, unknown>;
  let total = 0;
  for (const k of Object.keys(b)) if (!BAC_SPOTS.includes(k as BacSpot)) return '没有这个下注区';
  for (const s of BAC_SPOTS) {
    const v = b[s] ?? 0;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return '下注金额无效';
    if (v === 0) continue;
    if (v < r.minBet) return `每个区最低 ${r.minBet}`;
    if (v > r.maxBet) return `每个区最高 ${r.maxBet}`;
    total += v;
  }
  if (total <= 0) return '请先选择下注区';
  if (total > balance) return '金币不足';
  return null;
}

/** 把合法的下注整理成完整的三个区（调用前先用 bacBetError 检查） */
export function cleanBets(bets: Partial<BacBets>): BacBets {
  return { player: bets.player ?? 0, banker: bets.banker ?? 0, tie: bets.tie ?? 0 };
}
