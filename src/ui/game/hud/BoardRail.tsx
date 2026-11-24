// 手机 / 平板的公共牌条：牌桌上的 3D 公共牌在小屏幕上离镜头太远（点数只有几个像素高），
// 这里在底部操作区上方用清晰的 2D 牌再显示一次（和自己的两张底牌一样）。
// - 固定 5 个牌位：翻牌、转牌、河牌出现时不会让界面跳动；
// - 每张牌等牌桌上的 3D 牌翻开后才显示（与牌桌同一份节奏），不会提前“剧透”；
// - 组成自己当前最大牌型的公共牌加金边（和底牌的提示一致）。
// 只是显示：牌来自服务器 / 本地主机下发的牌局状态，不参与任何判断。电脑版不显示（牌桌上的牌已经足够大）。
import { useMemo } from 'react';
import type { TableView } from '../../../core/game/view';
import type { Card } from '../../../core/cards/card';
import { evaluateHand } from '../../../core/poker/handEvaluator';
import { boardRevealMs } from '../../../animation/motion';
import { HudCard } from './bits';

const SLOTS = [0, 1, 2, 3, 4];

export function BoardRail({ view }: { view: TableView }) {
  const me = view.players.find((p) => p.id === view.viewerId);
  const best = useMemo(() => {
    const hole = me?.hole.filter((c): c is Card => !!c) ?? [];
    if (!me || me.folded || hole.length < 2 || view.board.length < 3) return new Set<string>();
    return new Set(evaluateHand([...hole, ...view.board]).cards.map((c) => c.id));
  }, [me, view.board]);
  if (view.gameOver || view.handNumber < 1 || view.phase === 'idle') return null;
  return (
    <div className="board-rail" role="group" aria-label={view.board.length ? `公共牌 ${view.board.length} 张` : '公共牌（还没有发出）'}>
      {SLOTS.map((i) => {
        const c = view.board[i];
        return (
          <span key={i} className="rail-slot" aria-hidden={!c}>
            {c && <HudCard key={`${view.handNumber}-${c.id}`} card={c} size="board" highlight={best.has(c.id)} revealDelayMs={boardRevealMs(i)} />}
          </span>
        );
      })}
    </div>
  );
}
