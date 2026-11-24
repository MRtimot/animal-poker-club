// 牌局界面的小组件：倒计时条、动物头像、界面上的扑克牌、位置标记
import type { SeatView, TableView } from '../../../core/game/view';
import { isRed, rankLabel, SUIT_SYMBOL, type Card } from '../../../core/cards/card';
import { SPECIES_MAP } from '../../../core/player/profile';
import type { TurnClock } from './clock';
import { positionBadges } from './model';

/** 线性倒计时：用 CSS 动画平滑缩短（不靠每帧重渲染），最后 5 / 3 / 1 秒逐级变色 */
export function TimerBar({ clock, deadline, showSecs = true }: { clock: TurnClock; deadline: number; showSecs?: boolean }) {
  const pct = (clock.remaining / clock.total) * 100;
  return (
    <div className={`tbar ${clock.level}`} role="timer" aria-label={clock.human ? `剩余 ${clock.secs} 秒` : '思考中'}>
      <span className="tbar-track">
        <i key={deadline} style={{ width: `${pct}%`, animationDuration: `${clock.remaining}ms` }} />
      </span>
      {showSecs && clock.human && <span className="tbar-secs">{clock.secs}</span>}
    </div>
  );
}

/** 动物头像：物种表情 + 毛色底色；登录玩家显示公开头像 */
export function SeatAvatar({ p, size = 'md' }: { p: Pick<SeatView, 'profile'>; size?: 'sm' | 'md' | 'lg' }) {
  const sp = SPECIES_MAP[p.profile.animal.species];
  return (
    <span className={`savatar savatar-${size}`} style={{ ['--tint' as string]: sp?.color ?? '#7a6a58' }} aria-hidden>
      {p.profile.avatar ? <img src={p.profile.avatar} alt="" referrerPolicy="no-referrer" draggable={false} /> : <span>{sp?.emoji ?? '🐾'}</span>}
    </span>
  );
}

/**
 * 界面上的扑克牌（大号、清晰）：点数 + 花色，红黑分明。
 * size：sm 赢家演出 / md / lg 自己的底牌 / board 手机公共牌条（尺寸由 gameHud.css 的牌面尺寸系统计算）。
 * revealDelayMs：延迟出现（手机公共牌条等牌桌上的 3D 牌翻开后再显示）。
 */
export function HudCard({ card, highlight, dim, size = 'md', revealDelayMs }: { card: Card | null; highlight?: boolean; dim?: boolean; size?: 'sm' | 'md' | 'lg' | 'board'; revealDelayMs?: number }) {
  if (!card) return <span className={`hcard hcard-${size} back`} aria-label="未知的牌" />;
  const suit = SUIT_SYMBOL[card.suit];
  return (
    <span
      className={`hcard hcard-${size} ${isRed(card) ? 'red' : ''} ${card.rank === 10 ? 'ten' : ''} ${highlight ? 'hl' : ''} ${dim ? 'dim' : ''}`}
      aria-label={`${rankLabel(card.rank)}${suit}`}
      style={revealDelayMs ? { animationDelay: `${revealDelayMs}ms` } : undefined}
    >
      <b>{rankLabel(card.rank)}</b>
      <i>{suit}</i>
    </span>
  );
}

/** 庄 / 小盲 / 大盲 */
export function PosBadges({ view, id }: { view: Pick<TableView, 'dealerId' | 'sbId' | 'bbId' | 'phase'>; id: string }) {
  const badges = positionBadges(view, id);
  if (!badges.length) return null;
  return (
    <span className="posb-row">
      {badges.map((b) => (
        <span key={b.key} className={`posb posb-${b.key}`} title={b.key === 'd' ? '庄家' : b.label}>
          {b.key === 'd' ? 'D' : b.key === 'sb' ? 'SB' : 'BB'}
        </span>
      ))}
    </span>
  );
}
