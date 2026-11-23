// 牌局记录：这一手刚刚发生了什么（只显示已经演出的事件，不会提前剧透摊牌结果）
import { useMemo } from 'react';
import type { TableView } from '../../../core/game/view';
import { useFx } from '../../../store/fxStore';
import { feedEntries } from './model';

export function HandFeed({ view }: { view: TableView }) {
  const shown = useFx((s) => s.shown);
  const items = useMemo(() => feedEntries(view, shown, 5), [view, shown]);
  if (!items.length || view.handNumber === 0) return null;
  return (
    <aside className="gfeed" aria-label={`第 ${view.handNumber} 局记录`}>
      <div className="gfeed-head">本局记录</div>
      <ol aria-live="polite">
        {items.map((it) => (
          <li key={it.key} className={`gfeed-${it.tone}`}>
            <span className="gfeed-ico" aria-hidden>
              {it.icon}
            </span>
            <span>{it.text}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
