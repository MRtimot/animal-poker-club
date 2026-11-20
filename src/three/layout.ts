// 牌桌布局：座位、手牌、下注筹码、公共牌位置（客户端 3D 与特效共用）
import type { TableView } from '../core/game/view';

export type V3 = [number, number, number];

export const TABLE_R = 3.25;
export const TABLE_Y = 1.0; // 桌面高度
export const SEAT_R = 4.15;
export const SEAT_Y = 0.6;
export const DECK_POS: V3 = [0, TABLE_Y + 0.05, -1.55];
export const POT_POS: V3 = [0, TABLE_Y + 0.01, -0.85];
export const CARD_W = 0.5;
export const CARD_H = 0.7;

export interface SeatLayout {
  id: string;
  angle: number;
  seat: V3;
  cards: V3;
  bet: V3;
  head: V3;
  tag: V3;
  button: V3;
  muck: V3;
  isViewer: boolean;
}

const at = (angle: number, r: number, y: number): V3 => [Math.sin(angle) * r, y, Math.cos(angle) * r];

export function seatAngle(index: number, count: number, viewerIndex: number): number {
  return ((index - viewerIndex) / count) * Math.PI * 2;
}

export function computeLayout(view: Pick<TableView, 'players' | 'viewerId'>): Map<string, SeatLayout> {
  const n = view.players.length;
  const viewerIndex = Math.max(0, view.players.findIndex((p) => p.id === view.viewerId));
  const m = new Map<string, SeatLayout>();
  view.players.forEach((p, i) => {
    const a = seatAngle(i, n, viewerIndex);
    const isViewer = p.id === view.viewerId;
    m.set(p.id, {
      id: p.id,
      angle: a,
      seat: at(a, SEAT_R, SEAT_Y),
      cards: at(a, isViewer ? 2.45 : 2.6, TABLE_Y + 0.012),
      bet: at(a, 1.95, TABLE_Y + 0.01),
      head: at(a, SEAT_R, SEAT_Y + 2.45),
      // 自己的名牌放在侧边，避免挡住自己的手牌
      tag: isViewer ? [SEAT_R * 0.62, SEAT_Y + 1.2, SEAT_R * 0.92] : at(a, SEAT_R - 0.45, SEAT_Y + 2.3),
      button: at(a + 0.32, 2.35, TABLE_Y + 0.02),
      muck: at(a + 0.2, 1.35, TABLE_Y + 0.006),
      isViewer,
    });
  });
  return m;
}

export function boardPos(i: number): V3 {
  return [(i - 2) * 0.6, TABLE_Y + 0.012, 0.18];
}
