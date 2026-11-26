// 闲 / 庄两手牌的牌条：只显示已经落桌翻开的牌与点数；结果揭晓后标出赢的一方；下面是这张桌最近的真实结果（不能预测下一局）
import type { BacSide, BaccaratView } from '../../core/baccarat/types';
import { bacScore } from '../../core/baccarat/rules';
import { HudCard, SeatAvatar } from '../game/hud/bits';
import { useBacCine } from '../../animation/baccarat/cineStore';
import { useSettings } from '../../store/settingsStore';
import { useLandedCards } from './presented';

function Hand({ view, side, live, paid }: { view: BaccaratView; side: BacSide; live: boolean; paid: boolean }) {
  const cards = view.hands[side].cards;
  const shown = useLandedCards(cards, live);
  const open = cards.filter((c) => shown.has(c.uid));
  const score = open.length ? bacScore(open) : null;
  const natural = open.length === 2 && cards.length === 2 && view.hands[side].natural;
  const won = paid && view.result && (view.result.winner === side || view.result.winner === 'tie');
  const lost = paid && view.result && view.result.winner !== side && view.result.winner !== 'tie';
  const placeholders = view.phase === 'closed' || view.phase === 'dealing' ? Math.max(0, 2 - open.length) : 0;
  return (
    <div className={`bac-hand ${side}${won ? ' won' : ''}${lost ? ' lost' : ''}`} aria-label={`${side === 'player' ? '闲' : '庄'} ${score ?? ''} 点`}>
      <div className="bac-hand-label">
        <b>{side === 'player' ? '闲' : '庄'}</b>
        <small>{side === 'player' ? 'PLAYER' : 'BANKER'}</small>
      </div>
      <div className="bac-hand-cards">
        {open.map((c) => (
          <HudCard key={c.uid} card={c} size="sm" highlight={!!won} />
        ))}
        {Array.from({ length: placeholders }, (_, i) => (
          <HudCard key={'b' + i} card={null} size="sm" />
        ))}
      </div>
      <div className="bac-hand-score" role="status" aria-live="polite">
        <b>{score ?? ''}</b>
        {natural && <small>例牌</small>}
      </div>
    </div>
  );
}

/** 最近的真实结果（珠盘）：闲 = 蓝、庄 = 红、和 = 绿；同时写字，不只靠颜色 */
export function HistoryRoad({ view, limit = 24 }: { view: BaccaratView; limit?: number }) {
  const h = view.history.slice(-limit);
  if (!h.length) return null;
  return (
    <div className="bac-road" aria-label="最近的结果（只是记录，每一局都是独立的）" title="只是记录：每一局都是独立的，过去的结果不能预测下一局">
      {h.map((x) => (
        <span key={x.round} className={`bac-bead ${x.winner}${x.natural ? ' nat' : ''}`} aria-label={`第 ${x.round} 局 ${x.winner === 'player' ? '闲' : x.winner === 'banker' ? '庄' : '和'} ${x.player}:${x.banker}`}>
          {x.winner === 'player' ? '闲' : x.winner === 'banker' ? '庄' : '和'}
        </span>
      ))}
    </div>
  );
}

export function BacBoard({ view }: { view: BaccaratView }) {
  const paid = useBacCine((s) => s.paidRound === view.roundId);
  const live = view.phase === 'closed' || view.phase === 'dealing';
  const theme = useSettings((s) => s.bacCards);
  return (
    <section className={`bac-board cards-${theme}${view.phase === 'dealing' ? ' acting' : ''}`} aria-label="牌桌">
      <Hand view={view} side="player" live={live} paid={paid} />
      <div className="bac-board-dealer">
        <SeatAvatar p={view.dealer} size="sm" />
        <span>{view.dealer.profile.name}</span>
      </div>
      <Hand view={view} side="banker" live={live} paid={paid} />
      {view.phase === 'betting' && <div className="bac-board-hint">请下注 · 闲 1:1 · 庄 1:1 抽 5% · 和 8:1</div>}
      <HistoryRoad view={view} />
    </section>
  );
}
