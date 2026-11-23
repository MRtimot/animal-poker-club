// 玩家自己的信息区：我是谁、我的筹码、我的底牌与当前牌型、是否轮到我
import { useMemo } from 'react';
import type { TableView } from '../../../core/game/view';
import { describePartial, evaluateHand } from '../../../core/poker/handEvaluator';
import type { Card } from '../../../core/cards/card';
import { AnimatedChips } from '../../common/AnimatedNumber';
import { formatChips } from '../../../utils/format';
import { HudCard, PosBadges, SeatAvatar, TimerBar } from './bits';
import { turnClock, useServerNow } from './clock';

export function PlayerDock({ view }: { view: TableView }) {
  const me = view.players.find((p) => p.id === view.viewerId);
  const myTurn = !!me && view.currentPlayerId === me.id && !!view.legal;
  const now = useServerNow(myTurn);
  const clock = myTurn ? turnClock(view, now) : null;
  const info = useMemo(() => {
    if (!me) return null;
    const hole = me.hole.filter((c): c is Card => !!c);
    if (hole.length < 2) return null;
    const best = hole.length + view.board.length >= 5 ? evaluateHand([...hole, ...view.board]) : null;
    return { hole, name: best ? best.name : describePartial(hole), best: new Set(best?.cards.map((c) => c.id) ?? []) };
  }, [me, view.board]);
  if (!me) return null;

  const spectating = me.busted || (!me.inHand && view.phase !== 'idle' && view.phase !== 'complete');
  const state = me.folded ? '已弃牌' : me.allIn ? '已全押' : spectating ? (me.busted ? '筹码用完，正在观战' : '等待下一局') : '';
  return (
    <section className={`gdock-me ${myTurn ? 'myturn' : ''} ${me.folded ? 'folded' : ''}`} aria-label="我的座位">
      <div className="me-id">
        <SeatAvatar p={me} size="lg" />
        <div className="me-who">
          <div className="me-name">
            <span className="me-name-text">{me.name}</span>
            <span className="me-you">你</span>
            {me.profile.level ? <span className="me-lv">Lv.{me.profile.level}</span> : null}
            <PosBadges view={view} id={me.id} />
          </div>
          <div className="me-chips" aria-label={`我的筹码 ${formatChips(me.chips)}`}>
            <span className="chip-ico" aria-hidden />
            <AnimatedChips value={me.chips} />
          </div>
        </div>
      </div>
      <div className="me-hand">
        <div className="me-cards">
          {info ? (
            info.hole.map((c) => <HudCard key={c.id} card={c} size="lg" dim={me.folded} highlight={view.board.length >= 3 && !me.folded && info.best.has(c.id)} />)
          ) : (
            <>
              <HudCard card={null} size="lg" />
              <HudCard card={null} size="lg" />
            </>
          )}
        </div>
        <div className="me-strength">
          <small>{state || '当前牌型'}</small>
          <b>{info && !me.folded ? info.name : '—'}</b>
          {me.bet > 0 && <span className="me-bet">本轮已下注 {formatChips(me.bet)}</span>}
        </div>
      </div>
      {myTurn && clock && view.turnDeadline && (
        <div className="me-turn" role="status">
          <span className="me-turn-label">轮到你了</span>
          <TimerBar clock={clock} deadline={view.turnDeadline} />
        </div>
      )}
    </section>
  );
}
