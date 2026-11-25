// 21 点：跟随 3D 座位的名牌（其他玩家）、自己与庄家头顶的气泡 / 表情
import { memo } from 'react';
import { Html } from '@react-three/drei';
import { evaluateBlackjack, valueText } from '../../core/blackjack/hand';
import { RESULT_NAME } from '../../core/blackjack/rules';
import { DEALER_ID, type BjHandView, type BjSeatView, type BlackjackView } from '../../core/blackjack/types';
import { useGame } from '../../store/gameStore';
import { AnimatedChips } from '../../ui/common/AnimatedNumber';
import { SeatAvatar } from '../../ui/game/hud/bits';
import { usePresentedCards } from '../../ui/blackjack/presented';
import { formatChips } from '../../utils/format';
import type { SeatLayout } from '../layout';
import { Bubble, MoodBadge, SeatTimer, clampedPositionBlackjack } from '../scenes/SeatHud';

/** 头顶的气泡与表情（自己、庄家） */
export function BubbleAnchor({ id, layout, dy = 0.2 }: { id: string; layout: SeatLayout; dy?: number }) {
  return (
    <Html position={[layout.head[0], layout.head[1] + dy, layout.head[2]]} center zIndexRange={[18, 0]} calculatePosition={id === DEALER_ID ? clampedPositionBlackjack : undefined} style={{ pointerEvents: 'none' }}>
      <div className="splate-anchor">
        <Bubble playerId={id} />
        <MoodBadge playerId={id} />
      </div>
    </Html>
  );
}

function HandTag({ h, view, owner, paid }: { h: BjHandView; view: BlackjackView; owner: string; paid: boolean }) {
  const shown = usePresentedCards(view, owner, h.cards);
  const cards = h.cards.filter((c) => shown.has(c.uid));
  if (!cards.length) return null;
  const v = evaluateBlackjack(cards, h.fromSplit);
  const text = paid && h.result ? RESULT_NAME[h.result] : v.blackjack ? '黑杰克' : v.bust ? `爆牌 ${v.value}` : valueText(v);
  const cls = paid && h.result ? h.result : v.bust ? 'bust' : v.blackjack ? 'blackjack' : h.done ? 'done' : '';
  return <span className={`bjp-val ${cls}`}>{text}</span>;
}

export const BjSeatPlate = memo(function BjSeatPlate({ p, view, layout, paid }: { p: BjSeatView; view: BlackjackView; layout: SeatLayout; paid: boolean }) {
  const left = useGame((s) => p.left || (!!s.room && !s.room.solo && !s.room.members.some((m) => m.id === p.id)));
  const current = view.currentPlayerId === p.id;
  const offline = !p.connected && !p.isAI && !left;
  const profit = p.hands.length && p.hands.every((h) => h.result) ? p.hands.reduce((s, h) => s + h.payout - h.bet, 0) : 0;
  const status = left
    ? { text: '已离开', cls: 'out' }
    : offline
      ? { text: '重新连接中…', cls: 'offline' }
      : view.phase === 'betting'
        ? p.bet
          ? { text: `已下注 ${formatChips(p.bet)}`, cls: 'call' }
          : p.skipped
            ? { text: '这局不下注', cls: 'fold' }
            : { text: '选择下注…', cls: 'thinking' }
        : !p.hands.length
          ? { text: '旁观这一局', cls: 'fold' }
          : current
            ? { text: '思考中…', cls: 'thinking' }
            : null;
  const cls = [current && 'current', offline && 'offline', left && 'out', paid && profit > 0 && 'winner'].filter(Boolean).join(' ');
  return (
    <Html position={layout.tag} center zIndexRange={[20, 0]} calculatePosition={clampedPositionBlackjack} style={{ pointerEvents: 'none' }}>
      <div className={`splate bjp ${cls}`}>
        <Bubble playerId={p.id} />
        <MoodBadge playerId={p.id} />
        <div className="sp-main">
          <SeatAvatar p={p} size="sm" />
          <div className="sp-body">
            <div className="sp-name">
              <span className="sp-name-text">{p.name}</span>
              {p.isAI && <i className="sp-tag">AI</i>}
              {!p.isAI && p.profile.level ? <i className="sp-lv">Lv.{p.profile.level}</i> : null}
            </div>
            <div className="sp-chips">
              <span className="chip-ico" aria-hidden />
              <AnimatedChips value={view.phase === 'round-end' && !paid ? p.balance - p.hands.reduce((s, h) => s + h.payout, 0) : p.balance} />
            </div>
          </div>
        </div>
        {p.hands.length > 0 && (
          <div className="bjp-hands">
            {p.hands.map((h) => (
              <HandTag key={h.id} h={h} view={view} owner={p.id} paid={paid} />
            ))}
          </div>
        )}
        {status && <div className={`sp-status ${status.cls}`}>{status.text}</div>}
        {current && <SeatTimer view={view} />}
        {paid && profit > 0 && <div className="sp-win">+{formatChips(profit)}</div>}
      </div>
    </Html>
  );
});
