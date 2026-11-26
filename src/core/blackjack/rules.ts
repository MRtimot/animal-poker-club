// 21 点规则配置、下注校验、赔付（纯函数；服务器与本地共用同一份）

export interface BlackjackRules {
  /** 每局使用几副牌（V1 锁定：每局一副新的 52 张） */
  decks: number;
  /** 黑杰克赔率（默认 3:2） */
  blackjackPayout: readonly [number, number];
  minBet: number;
  maxBet: number;
  /** 一名玩家最多几手牌（分牌上限） */
  maxHands: number;
}

/**
 * V1 锁定的规则（本地、服务器、AI 同一份；任何配置或旧的牌局状态都不能改变）：
 * 每局一副新的 52 张牌，加密安全随机数 + Fisher–Yates 洗牌；
 * 庄家不足 17 要牌、17 及以上（含软 17）停牌；黑杰克 3:2；只有最初两张牌可以加倍；
 * 最初两张牌面相同才能分牌，只分一次（两手）；分 A 每手只补一张；没有保险、投降、边注。
 */
/** 保险（Insurance）没有实现，因此规则与界面里都没有它 */
export const DEFAULT_RULES: BlackjackRules = {
  decks: 1,
  blackjackPayout: [3, 2],
  minBet: 10,
  maxBet: 500,
  maxHands: 2,
};

/** 下注筹码面额：与牌桌上已有的实体筹码一致（不引入新的面额） */
export const BET_CHIPS = [5, 25, 100, 500, 1000] as const;

/** 虚拟金币用完（不够最低下注）时俱乐部补给到这个数额（免费，没有任何购买） */
export const REFILL_CHIPS = 500;

export interface TableTier {
  id: string;
  name: string;
  minBet: number;
  maxBet: number;
}

/** 单人桌的三档限额 */
export const TABLE_TIERS: readonly TableTier[] = [
  { id: 'low', name: '休闲桌', minBet: 10, maxBet: 200 },
  { id: 'mid', name: '俱乐部桌', minBet: 50, maxBet: 1000 },
  { id: 'high', name: '贵宾桌', minBet: 200, maxBet: 5000 },
];

export const tierById = (id: unknown): TableTier => TABLE_TIERS.find((t) => t.id === id) ?? TABLE_TIERS[0];

/** 下注是否合法：返回 null 表示可以下注，否则是给玩家看的原因 */
export function betError(amount: unknown, balance: number, r: Pick<BlackjackRules, 'minBet' | 'maxBet'>): string | null {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return '下注金额无效';
  if (amount < r.minBet) return `最低下注 ${r.minBet}`;
  if (amount > r.maxBet) return `最高下注 ${r.maxBet}`;
  if (amount > balance) return '金币不足';
  return null;
}

export type HandResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'dealer-blackjack' | 'forfeit';

export const RESULT_NAME: Record<HandResult, string> = {
  blackjack: '黑杰克',
  win: '赢',
  push: '平局',
  lose: '输',
  bust: '爆牌',
  'dealer-blackjack': '庄家黑杰克',
  forfeit: '离桌',
};

/** 这一手应当返还给玩家的总额（含本金）。黑杰克盈利向下取整，筹码始终是整数 */
export function payoutFor(bet: number, result: HandResult, r: Pick<BlackjackRules, 'blackjackPayout'>): number {
  switch (result) {
    case 'blackjack':
      return bet + Math.floor((bet * r.blackjackPayout[0]) / r.blackjackPayout[1]);
    case 'win':
      return bet * 2;
    case 'push':
      return bet;
    default:
      return 0;
  }
}

/** 补齐缺失 / 非法的规则（读取保存的牌局或外部输入时） */
export function cleanRules(x: Partial<BlackjackRules> | null | undefined): BlackjackRules {
  const r = { ...DEFAULT_RULES, ...(x ?? {}) };
  const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d);
  const minBet = int(r.minBet, 1, 1_000_000, DEFAULT_RULES.minBet);
  return {
    blackjackPayout: DEFAULT_RULES.blackjackPayout,
    maxHands: DEFAULT_RULES.maxHands,
    decks: DEFAULT_RULES.decks,
    minBet,
    maxBet: Math.max(minBet, int(r.maxBet, 1, 10_000_000, DEFAULT_RULES.maxBet)),
  };
}
