// 百家乐公平性核对（纯函数）：不调用引擎的规则代码，用标准补牌表的字面数据从牌重新推算，用来检查引擎。
// 模拟、测试与开发调试面板共用。这里只读结果，从不参与发牌或结算。
import type { Card } from '../cards/card';
import type { BacBets, BacWinner } from './rules';

type C = Pick<Card, 'rank'>;

const value = (c: C) => (c.rank === 14 ? 1 : c.rank >= 10 ? 0 : c.rank);
const score = (cs: readonly C[]) => cs.reduce((s, c) => s + value(c), 0) % 10;

/** 标准庄家补牌表：行 = 庄家两张点数 0–7，列 = 闲家第三张点数 0–9（D 补 / S 停） */
const BANKER_TABLE = ['DDDDDDDDDD', 'DDDDDDDDDD', 'DDDDDDDDDD', 'DDDDDDDDSD', 'SSDDDDDDSS', 'SSSSDDDDSS', 'SSSSSSDDSS', 'SSSSSSSSSS'];

/** 按规则这一局双方应该各有几张牌 */
export function expectedCardCounts(player: readonly C[], banker: readonly C[]): { player: number; banker: number } {
  const p2 = score(player.slice(0, 2));
  const b2 = score(banker.slice(0, 2));
  if (p2 >= 8 || b2 >= 8) return { player: 2, banker: 2 };
  if (p2 >= 6) return { player: 2, banker: b2 <= 5 ? 3 : 2 };
  // 闲家补第三张
  if (player.length < 3) return { player: 3, banker: 2 };
  const third = value(player[2]);
  return { player: 3, banker: b2 <= 7 && BANKER_TABLE[b2][third] === 'D' ? 3 : 2 };
}

export function expectedWinner(player: readonly C[], banker: readonly C[]): BacWinner {
  const p = score(player);
  const b = score(banker);
  return p > b ? 'player' : b > p ? 'banker' : 'tie';
}

/** 固定赔付表：返还总额（含本金）。闲 2 倍；庄 1 + 0.95（向下取整）；和 9 倍；开和时闲庄退回 */
export function expectedReturns(bets: BacBets, w: BacWinner): BacBets {
  return {
    player: w === 'player' ? bets.player * 2 : w === 'tie' ? bets.player : 0,
    banker: w === 'banker' ? bets.banker + Math.floor((bets.banker * 95) / 100) : w === 'tie' ? bets.banker : 0,
    tie: w === 'tie' ? bets.tie * 9 : 0,
  };
}
