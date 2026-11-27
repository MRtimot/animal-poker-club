// 牌桌布局：座位、手牌、下注筹码、公共牌位置（客户端 3D 与特效共用）
import type { TableView } from '../core/game/view';

export type V3 = [number, number, number];

export const TABLE_R = 3.25;
export const TABLE_Y = 1.0; // 桌面高度
export const SEAT_R = 4.15;
export const SEAT_Y = 0.6;
export const DECK_POS: V3 = [0, TABLE_Y + 0.05, -1.55];
export const POT_POS: V3 = [0, TABLE_Y + 0.01, -1.0];
/** 弃牌堆：牌堆右侧 */
export const MUCK_POS: V3 = [0.82, TABLE_Y + 0.006, -1.5];
export const CARD_W = 0.5;
export const CARD_H = 0.7;
/** 公共牌放大倍数与间距：牌桌镜头较远，公共牌是牌局的视觉中心 */
export const BOARD_SCALE = 1.25;
export const BOARD_GAP = 0.71;

export interface SeatLayout {
  id: string;
  angle: number;
  seat: V3;
  cards: V3;
  bet: V3;
  /** 玩家面前桌上的筹码堆 */
  stack: V3;
  head: V3;
  tag: V3;
  button: V3;
  muck: V3;
  isViewer: boolean;
  /**
   * 脸的真实位置与体型（只有站着的动物庄家需要：它比坐着的动物高、更靠前、放大了一些）。
   * 没有时按坐着的动物计算（head 下方 FACE_DROP）。只用于电影镜头取景。
   */
  face?: V3;
  faceScale?: number;
}

const at = (angle: number, r: number, y: number): V3 => [Math.sin(angle) * r, y, Math.cos(angle) * r];

export function seatAngle(index: number, count: number, viewerIndex: number): number {
  return ((index - viewerIndex) / count) * Math.PI * 2;
}

/** 圆桌上某个角度的一个座位（0 = 镜头前的自己，π = 正对面） */
export function seatLayoutAt(id: string, a: number, isViewer: boolean): SeatLayout {
  return {
    id,
    angle: a,
    seat: at(a, SEAT_R, SEAT_Y),
    cards: at(a, isViewer ? 2.45 : 2.6, TABLE_Y + 0.012),
    bet: at(a, 2.08, TABLE_Y + 0.01),
    stack: at(a - (isViewer ? 0.3 : 0.34), 2.72, TABLE_Y + 0.004),
    head: at(a, SEAT_R, SEAT_Y + 2.45),
    // 名牌在动物头顶上方（不遮住脸）；自己的信息在屏幕下方的座位面板里
    tag: isViewer ? [SEAT_R * 0.62, SEAT_Y + 1.2, SEAT_R * 0.92] : at(a, SEAT_R + 0.05, SEAT_Y + 2.95),
    button: at(a + 0.32, 2.35, TABLE_Y + 0.02),
    // 弃牌推到牌堆旁边的弃牌堆（不进入公共牌区域）；每个座位略有偏移，叠成自然的一小堆
    muck: [MUCK_POS[0] + Math.sin(a) * 0.16, TABLE_Y + 0.006 + ((a / (Math.PI * 2) + 1) % 1) * 0.018, MUCK_POS[2] + Math.cos(a) * 0.1],
    isViewer,
  };
}

export function computeLayout(view: Pick<TableView, 'players' | 'viewerId'>): Map<string, SeatLayout> {
  const n = view.players.length;
  const viewerIndex = Math.max(0, view.players.findIndex((p) => p.id === view.viewerId));
  const m = new Map<string, SeatLayout>();
  view.players.forEach((p, i) => {
    m.set(p.id, seatLayoutAt(p.id, seatAngle(i, n, viewerIndex), p.id === view.viewerId));
  });
  return m;
}

export function boardPos(i: number): V3 {
  return [(i - 2) * BOARD_GAP, TABLE_Y + 0.012, 0.18];
}

// ───────── 玩家对庄家的牌桌（21 点、百家乐共用） ─────────

/** 庄家在正对面：自己在 0，其余玩家左右依次排开；正对面留给庄家 */
export function seatAngles(count: number, viewerIndex: number): number[] {
  // 人少时离镜头远一些（坐在侧面），人多时均匀排开；最外侧不超过 1.75 弧度，正对面留给庄家
  const step = Math.min(1, 1.75 / Math.max(1, Math.floor(count / 2)));
  return Array.from({ length: count }, (_, i) => {
    const k = (((i - viewerIndex) % count) + count) % count;
    return (k <= count / 2 ? k : k - count) * step;
  });
}

