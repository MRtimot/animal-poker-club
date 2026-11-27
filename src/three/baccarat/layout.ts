// 百家乐牌桌布局：庄家在正对面；闲（左）/ 庄（右）的牌放在桌子中央；玩家沿近侧弧线排开（自己永远在镜头前），
// 每个座位前面有闲 / 和 / 庄三个下注圈。
import type { BacSide, BaccaratView } from '../../core/baccarat/types';
import { BAC_DEALER_ID } from '../../core/baccarat/types';
import type { BacSpot } from '../../core/baccarat/rules';
import { BOARD_SCALE, TABLE_Y, seatAngles, seatLayoutAt, type SeatLayout, type V3 } from '../layout';

export { SHOE_POS, DISCARD_POS, TRAY_POS, DEALER_Z, DEALER_STAND, DEALER_SCALE } from '../blackjack/layout';
import { dealerLayout } from '../blackjack/layout';

const CARD_Y = TABLE_Y + 0.024;
/** 闲 / 庄两手牌的中心 */
export const HAND_X = 1.02;
export const HAND_Z = -0.78;
const GAP = 0.68;

function around(a: number, r: number, t: number): V3 {
  return [Math.sin(a) * r + Math.cos(a) * t, TABLE_Y + 0.01, Math.cos(a) * r - Math.sin(a) * t];
}

export function computeBaccaratLayout(view: Pick<BaccaratView, 'players' | 'viewerId'>): Map<string, SeatLayout> {
  return layoutBacSeats(
    view.players.map((p) => p.id),
    view.viewerId,
  );
}

export function layoutBacSeats(ids: readonly string[], viewerId: string): Map<string, SeatLayout> {
  const angles = seatAngles(ids.length, Math.max(0, ids.indexOf(viewerId)));
  const m = new Map<string, SeatLayout>();
  ids.forEach((id, i) => m.set(id, { ...seatLayoutAt(id, angles[i], id === viewerId), bet: around(angles[i], 2.05, 0) }));
  m.set(BAC_DEALER_ID, dealerLayout(BAC_DEALER_ID));
  return m;
}

/** 一张牌的位置：前两张并排，第三张横放在两张下面（靠近玩家一侧） */
export function bacCardTarget(side: BacSide, index: number): { pos: V3; yaw: number; scale: number } {
  const cx = side === 'player' ? -HAND_X : HAND_X;
  if (index < 2) return { pos: [cx + (index - 0.5) * GAP, CARD_Y + index * 0.006, HAND_Z], yaw: 0, scale: BOARD_SCALE };
  return { pos: [cx, CARD_Y + 0.012, HAND_Z + 0.86], yaw: Math.PI / 2, scale: BOARD_SCALE };
}

/** 两手牌的中心（镜头特写、粒子） */
export const handCenterOf = (side: BacSide): V3 => [side === 'player' ? -HAND_X : HAND_X, TABLE_Y, HAND_Z + 0.3];

/** 座位前的三个下注圈：闲（左）、和（中）、庄（右），从玩家的角度看 */
const SPOT_T: Record<BacSpot, number> = { player: -0.42, tie: 0, banker: 0.42 };
export function bacSpotPos(l: SeatLayout, spot: BacSpot): V3 {
  return around(l.angle, 2.05, SPOT_T[spot]);
}
