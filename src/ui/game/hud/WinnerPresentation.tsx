// 赢家演出：由事件导演在派奖时刻触发（fxStore.present），界面只负责展示，不自己计时去“猜”结果
import { useEffect, useState } from 'react';
import type { TableView } from '../../../core/game/view';
import { useFx } from '../../../store/fxStore';
import { formatChips } from '../../../utils/format';
import { HudCard, SeatAvatar } from './bits';

export function WinnerPresentation({ view }: { view: TableView }) {
  const p = useFx((s) => s.presentation);
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState<number | null>(null);
  useEffect(() => {
    if (!p) return;
    setLeaving(false);
    setHidden(null);
    const out = setTimeout(() => setLeaving(true), Math.max(600, p.duration - 450));
    const gone = setTimeout(() => setHidden(p.id), p.duration);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 下一手已经开始 / 整场结束 / 已播完：不再显示
  if (!p || hidden === p.id || p.hand !== view.handNumber || view.gameOver) return null;
  const seat = (id: string) => view.players.find((x) => x.id === id);
  const viewerWon = p.winners.some((w) => w.playerId === view.viewerId);
  const title = p.tie ? '平分底池' : viewerWon ? '你赢了' : '赢家';
  const compact = p.uncontested;
  return (
    <div className={`winp ${compact ? 'compact' : ''} ${viewerWon ? 'mine' : ''} ${leaving ? 'leaving' : ''}`} role="status" aria-live="polite">
      <div className="winp-kicker">{title}</div>
      <div className="winp-list">
        {p.winners.map((w) => {
          const s = seat(w.playerId);
          if (!s) return null;
          const best = new Set(w.cards.map((c) => c.id));
          const holeIds = new Set(s.hole.filter(Boolean).map((c) => c!.id));
          return (
            <div key={w.playerId} className="winp-row">
              <div className="winp-who">
                <SeatAvatar p={s} size="md" />
                <div>
                  <div className="winp-name">{w.playerId === view.viewerId ? `${s.name}（你）` : s.name}</div>
                  {w.handName && <div className="winp-hand">{w.handName}</div>}
                  {compact && <div className="winp-sub">其他玩家都弃牌了</div>}
                </div>
              </div>
              {w.cards.length > 0 && (
                <div className="winp-cards" aria-label="获胜的五张牌">
                  {w.cards.map((c) => (
                    <HudCard key={c.id} card={c} size="sm" highlight={best.has(c.id) && holeIds.has(c.id)} />
                  ))}
                </div>
              )}
              <div className="winp-amount">
                <span className="chip-ico" aria-hidden />+{formatChips(w.amount)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
