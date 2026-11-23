// 奖励结算闸门：决定这一次收到的牌局状态是否需要结算“一手牌”或“整场”的奖励。
// 保证每一手、每一场只结算一次：重连 / 刷新不会重复发奖，换了一场对局也不会漏发。
import type { TableView } from '../core/game/view';

export class ProgressGate {
  private doneHand = -1;
  private doneGame = false;
  private startHand: number | null = null;

  /** 离开牌桌：下一场对局从头开始计数 */
  reset(): void {
    this.doneHand = -1;
    this.doneGame = false;
    this.startHand = null;
  }

  /** 这一场从第几手开始看到（用于统计打了多少手） */
  get firstHand(): number | null {
    return this.startHand;
  }

  check(view: Pick<TableView, 'handNumber' | 'phase' | 'summary' | 'gameOver'>): { hand: boolean; game: boolean } {
    if (this.startHand !== null && view.handNumber < this.startHand) {
      // 新开了一场（再来一局 / 新房间）
      this.startHand = null;
      this.doneHand = -1;
    }
    // 从第一手真正发牌开始计数（第 0 手是还没发牌的空桌）
    if (this.startHand === null && view.handNumber >= 1) {
      this.startHand = view.handNumber;
      // 重连 / 刷新时不重复结算：已经结束的这一手、已经结束的整场都不再发奖励
      if (view.phase === 'complete') this.doneHand = view.handNumber;
      if (view.gameOver) this.doneGame = true;
    }
    let hand = false;
    let game = false;
    if (view.phase === 'complete' && view.summary && view.handNumber !== this.doneHand) {
      this.doneHand = view.handNumber;
      hand = true;
    }
    if (view.gameOver && !this.doneGame) {
      this.doneGame = true;
      game = true;
    }
    if (!view.gameOver) this.doneGame = false;
    return { hand, game };
  }
}
