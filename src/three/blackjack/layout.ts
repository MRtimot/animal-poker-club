// 21 点牌桌布局：庄家在正对面，玩家沿近侧弧线排开（自己永远在镜头前）；手牌、下注圈、牌靴、弃牌盒、筹码盘的位置
import type { BlackjackView } from '../../core/blackjack/types';
import { DEALER_ID } from '../../core/blackjack/types';
import { BJ_TIMING } from '../../core/blackjack/controller';
import { BOARD_SCALE, TABLE_Y, seatLayoutAt, type SeatLayout, type V3 } from '../layout';

export const SHOE_POS: V3 = [1.72, TABLE_Y + 0.2, -1.7];
export const DISCARD_POS: V3 = [-1.78, TABLE_Y + 0.07, -1.7];
/** 庄家的筹码盘 */
export const TRAY_POS: V3 = [0, TABLE_Y + 0.01, -2.5];
export const DEALER_Z = -1.28;

/** 自己在 0，其余玩家左右依次排开；正对面留给庄家 */
export function seatAngles(count: number, viewerIndex: number): number[] {
  // 人少时离镜头远一些（坐在侧面），人多时均匀排开；最外侧不超过 1.75 弧度，正对面留给庄家
  const step = Math.min(1, 1.75 / Math.max(1, Math.floor(count / 2)));
  return Array.from({ length: count }, (_, i) => {
    const k = (((i - viewerIndex) % count) + count) % count;
    return (k <= count / 2 ? k : k - count) * step;
  });
}

export function computeBlackjackLayout(view: Pick<BlackjackView, 'players' | 'viewerId'>): Map<string, SeatLayout> {
  return layoutSeats(
    view.players.map((p) => p.id),
    view.viewerId,
  );
}

export function layoutSeats(ids: readonly string[], viewerId: string): Map<string, SeatLayout> {
  const angles = seatAngles(ids.length, Math.max(0, ids.indexOf(viewerId)));
  const m = new Map<string, SeatLayout>();
  ids.forEach((id, i) => m.set(id, { ...seatLayoutAt(id, angles[i], id === viewerId), bet: around(angles[i], 2.62, 0) }));
  m.set(DEALER_ID, seatLayoutAt(DEALER_ID, Math.PI, false));
  return m;
}

/** 角度 a、半径 r、沿切线偏移 t 的桌面点 */
function around(a: number, r: number, t: number): V3 {
  return [Math.sin(a) * r + Math.cos(a) * t, TABLE_Y + 0.01, Math.cos(a) * r - Math.sin(a) * t];
}

/** 牌离桌面的高度：比接触阴影的偏移量高，阴影不会盖到牌面上 */
const CARD_Y = TABLE_Y + 0.024;

const SCALE_ME = [1.2, 1.02, 0.86, 0.74];
const SCALE_OTHER = [1, 0.8, 0.66, 0.56];

/** 玩家一手牌里第 i 张的位置。多手（分牌）并排，牌张沿切线错开叠放 */
export function handCardTarget(l: SeatLayout, hand: number, hands: number, i: number, n: number, doubled: boolean): { pos: V3; yaw: number; scale: number } {
  const scale = (l.isViewer ? SCALE_ME : SCALE_OTHER)[Math.min(3, hands - 1)];
  const off = handOffset(hand, hands, scale);
  const fan = n > 5 ? 0.15 : 0.21;
  const t = off + (i - (n - 1) / 2) * fan * scale;
  const r = (l.isViewer ? 1.86 : 1.92) - i * 0.045 * scale;
  const [x, , z] = around(l.angle, r, t);
  // 加倍拿到的那张横放
  const sideways = doubled && i === n - 1;
  return { pos: [x, CARD_Y + i * 0.007 + hand * 0.001, z], yaw: l.angle + (sideways ? Math.PI / 2 : 0), scale };
}

function handOffset(hand: number, hands: number, scale: number) {
  return (hand - (hands - 1) / 2) * scale * 0.98;
}

/** 这一手的下注圈位置 */
export function handBetPos(l: SeatLayout, hand: number, hands: number): V3 {
  const scale = (l.isViewer ? SCALE_ME : SCALE_OTHER)[Math.min(3, hands - 1)];
  // 自己的下注圈偏右一点：正中间会被自己动物的头挡住
  const own = l.isViewer ? 0.7 : 0;
  return around(l.angle, l.isViewer ? 2.5 : 2.62, hands === 1 ? own : own + (hand - (hands - 1) / 2) * (l.isViewer ? 0.5 : 0.9 * scale));
}

/** 这一手牌的中心（镜头特写、粒子） */
export function handCenter(l: SeatLayout): V3 {
  return around(l.angle, 1.8, 0);
}

export function dealerCardTarget(i: number, n: number): { pos: V3; scale: number } {
  const gap = n <= 3 ? 0.68 : n <= 5 ? 0.54 : 0.4;
  return { pos: [(i - (n - 1) / 2) * gap, CARD_Y + i * 0.006, DEALER_Z], scale: BOARD_SCALE };
}

/** 发牌时第几张发出（庄家明牌 → 每位下注的玩家 → 庄家暗牌 → 每位下注的玩家） */
export function dealIndex(view: Pick<BlackjackView, 'players'>, owner: string, cardIndex: number): number {
  const active = view.players.filter((p) => p.hands.length);
  const j = owner === DEALER_ID ? 0 : active.findIndex((p) => p.id === owner) + 1;
  return cardIndex * (active.length + 1) + Math.max(0, j);
}

/** 这张牌出现前的延迟：发牌阶段依次发出，其余时候立刻 */
export const dealDelay = (view: Pick<BlackjackView, 'players' | 'phase'>, owner: string, cardIndex: number) =>
  view.phase === 'dealing' && cardIndex < 2 ? dealIndex(view, owner, cardIndex) * BJ_TIMING.card : 0;
