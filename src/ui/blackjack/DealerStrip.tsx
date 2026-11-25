// 庄家：名字、性格、明牌与暗牌、点数。暗牌翻开前这里没有任何点数信息（视图里就没有）
import { evaluateBlackjack, valueText } from '../../core/blackjack/hand';
import { DEALER_ID, type BlackjackView } from '../../core/blackjack/types';
import { HudCard, SeatAvatar } from '../game/hud/bits';
import { usePresentedCards } from './presented';

export function DealerStrip({ view }: { view: BlackjackView }) {
  const d = view.dealer;
  const shown = usePresentedCards(view, DEALER_ID, d.cards);
  const open = d.cards.filter((c) => c !== null && shown.has(c.uid)).map((c) => c!);
  const v = open.length ? evaluateBlackjack(open) : null;
  const hidden = d.cards.length >= 2 && (!d.cards[1] || !shown.has(d.cards[1].uid));
  const note = !v ? '' : d.revealed && v.blackjack && d.cards.length === 2 && open.length === 2 ? '黑杰克' : v.bust ? '爆牌' : hidden ? '明牌' : '';
  return (
    <section className={`bj-dealer${view.phase === 'dealer-turn' ? ' acting' : ''}`} aria-label="庄家">
      <SeatAvatar p={d} size="md" />
      <div className="bj-dealer-who">
        <div className="bj-dealer-name">
          <small>庄家</small>
          {d.profile.name}
        </div>
        <div className="bj-dealer-trait">{d.trait}</div>
      </div>
      <div className="bj-dealer-cards">
        {!d.cards.length && <span className="bj-dealer-hint">{view.phase === 'betting' ? '请下注' : '准备中'}</span>}
        {d.cards.map((c, i) => (c && shown.has(c.uid) ? <HudCard key={c.uid} card={c} size="sm" /> : i === 1 ? <HudCard key="hole" card={null} size="sm" /> : null))}
      </div>
      <div className={`bj-dealer-value${v?.bust ? ' bust' : ''}`} role="status" aria-live="polite">
        <b>{v ? valueText(v) : ''}</b>
        {note && <small>{note}</small>}
      </div>
    </section>
  );
}
