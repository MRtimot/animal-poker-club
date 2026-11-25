// 仅供测试与开发调试：指定接下来发出的牌。
// 只在已有的牌靴里“交换位置”（不会凭空多出牌），正式构建不引用这个文件（见 localBlackjack 的动态加载）。
import { cardFromCode, type ShoeState } from './shoe';

/** 把第 offset 张（从下一张开始数，0 起）换成指定的牌 */
export function rigShoe(s: ShoeState, want: ReadonlyMap<number, string>): ShoeState {
  const order = [...s.order];
  const fixed = new Set([...want.keys()].map((k) => s.next + k));
  for (const [offset, id] of want) {
    const at = s.next + offset;
    if (at >= order.length) throw new Error('牌靴里没有这么多牌');
    if (cardFromCode(order[at]).id === id) continue;
    let from = -1;
    for (let i = s.next; i < order.length; i++) if (!(fixed.has(i) && want.get(i - s.next) === cardFromCode(order[i]).id) && cardFromCode(order[i]).id === id) from = i;
    if (from < 0) throw new Error(`牌靴里找不到 ${id}`);
    [order[at], order[from]] = [order[from], order[at]];
  }
  return { ...s, order };
}

/** 按顺序指定接下来的牌 */
export const rigNext = (s: ShoeState, ids: readonly string[]) => rigShoe(s, new Map(ids.map((id, i) => [i, id])));

export type ForcedOutcome = 'blackjack' | 'bust' | 'push' | 'dealer-blackjack' | 'win' | 'loss' | 'split' | 'resplit';

const PLAN: Record<ForcedOutcome, { up: string; hole: string; me: [string, string]; next?: string[] }> = {
  blackjack: { up: '9d', hole: '8c', me: ['As', 'Kh'] },
  bust: { up: '7d', hole: 'Tc', me: ['Ts', '6h'], next: ['Kd'] },
  push: { up: 'Kd', hole: '9c', me: ['Ks', '9h'] },
  'dealer-blackjack': { up: 'Ad', hole: 'Kc', me: ['Ts', '9h'] },
  win: { up: '9d', hole: '9c', me: ['Ks', 'Qh'] },
  loss: { up: 'Kd', hole: '9c', me: ['Ts', '8h'] },
  split: { up: '6d', hole: 'Tc', me: ['8s', '8h'] },
  // 拆开后两手又各拿到一张 8：可以拆到四手
  resplit: { up: '6d', hole: 'Tc', me: ['8s', '8h'], next: ['8d', '8c'] },
};

/** 发牌顺序：庄家明牌 → 每位玩家 → 庄家暗牌 → 每位玩家。me：自己是第几位下注的玩家 */
export function forceOutcome(s: ShoeState, kind: ForcedOutcome, me: number, players: number): ShoeState {
  const p = PLAN[kind];
  const want = new Map<number, string>([
    [0, p.up],
    [1 + me, p.me[0]],
    [1 + players, p.hole],
    [2 + players + me, p.me[1]],
  ]);
  (p.next ?? []).forEach((id, i) => want.set(2 + players * 2 + i, id));
  return rigShoe(s, want);
}
