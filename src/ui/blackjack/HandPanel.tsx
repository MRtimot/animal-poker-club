// 自己的座位：头像、名字、余额、每一手的牌 / 点数 / 下注 / 结果。牌与点数跟着 3D 动画翻开才显示
import { evaluateBlackjack, valueText } from '../../core/blackjack/hand';
import { RESULT_NAME } from '../../core/blackjack/rules';
import type { BjHandView, BjSeatView, BlackjackView } from '../../core/blackjack/types';
import { AnimatedChips } from '../common/AnimatedNumber';
import { HudCard, SeatAvatar } from '../game/hud/bits';
import { formatChips } from '../../utils/format';
import { usePresentedCards } from './presented';

/** 显示给自己的点数文字（不只靠颜色区分） */
export function handLabel(cards: Parameters<typeof evaluateBlackjack>[0], fromSplit: boolean): { text: string; note: string; cls: string } {
  if (!cards.length) return { text: '—', note: '', cls: '' };
  const v = evaluateBlackjack(cards, fromSplit);
  if (v.blackjack) return { text: '21', note: '黑杰克', cls: 'blackjack' };
  if (v.bust) return { text: String(v.value), note: '爆牌', cls: 'bust' };
  return { text: valueText(v), note: v.soft && v.value < 21 ? '软' : v.value === 21 ? '21 点' : '', cls: v.value === 21 ? 'full' : '' };
}

function Hand({ h, view, owner, active, paid, many }: { h: BjHandView; view: BlackjackView; owner: string; active: boolean; paid: boolean; many: boolean }) {
  const shown = usePresentedCards(view, owner, h.cards);
  const cards = h.cards.filter((c) => shown.has(c.uid));
  const label = handLabel(cards, h.fromSplit);
  return (
    <div className={`bj-hand${active ? ' active' : ''}${many ? ' many' : ''} ${paid && h.result ? 'r-' + h.result : ''}`} aria-label={`这一手 ${label.text} 点 ${label.note}，下注 ${h.bet}`}>
      <div className={`bj-cards c${Math.min(7, cards.length)}`}>
        {cards.map((c) => (
          <HudCard key={c.uid} card={c} size="lg" />
        ))}
        {!cards.length && (
          <>
            <HudCard card={null} size="lg" />
            <HudCard card={null} size="lg" />
          </>
        )}
      </div>
      <div className="bj-hand-info">
        <span className={`bj-value ${label.cls}`}>
          <b>{label.text}</b>
          {label.note && <small>{label.note}</small>}
        </span>
        <span className="bj-hand-bet">
          {paid && h.result ? (
            <i className={`bj-result ${h.result}`}>
              {RESULT_NAME[h.result]} {h.payout - h.bet > 0 ? `+${formatChips(h.payout - h.bet)}` : h.payout - h.bet < 0 ? `−${formatChips(h.bet - h.payout)}` : ''}
            </i>
          ) : (
            <>
              下注 {formatChips(h.bet)}
              {h.doubled && <small>（已加倍）</small>}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

export function HandPanel({ view, me, paid }: { view: BlackjackView; me: BjSeatView; paid: boolean }) {
  const mine = view.currentPlayerId === me.id;
  const balance = view.phase === 'round-end' && !paid ? me.balance - me.hands.reduce((s, h) => s + h.payout, 0) : me.balance;
  return (
    <section className={`bj-me${mine ? ' myturn' : ''}${me.hands.length > 1 ? ' split' : ''}`} aria-label="我的座位">
      <div className="bj-id">
        <SeatAvatar p={me} size="lg" />
        <div className="bj-who">
          <div className="me-name">
            <span className="me-name-text">{me.name}</span>
            <span className="me-you">你</span>
            {me.profile.level ? <span className="me-lv">Lv.{me.profile.level}</span> : null}
          </div>
          <div className="me-chips" aria-label={`${view.economy === 'profile' ? '金币' : '桌上筹码'} ${formatChips(balance)}`}>
            <span className="chip-ico" aria-hidden />
            <AnimatedChips value={balance} />
          </div>
          <div className="bj-wallet">{view.economy === 'profile' ? '我的金币' : '桌上筹码'}</div>
        </div>
      </div>
      <div className={`bj-hands n${me.hands.length}`}>
        {me.hands.length ? (
          me.hands.map((h) => <Hand key={h.id} h={h} view={view} owner={me.id} active={view.currentHandId === h.id} paid={paid} many={me.hands.length > 1} />)
        ) : (
          <div className="bj-hand empty" aria-hidden>
            <div className="bj-cards">
              <HudCard card={null} size="lg" />
              <HudCard card={null} size="lg" />
            </div>
          </div>
        )}
      </div>
      {mine && <span className="bj-turn">轮到你了{me.hands.length > 1 ? ` · 第 ${me.activeHand + 1} 手` : ''}</span>}
    </section>
  );
}
