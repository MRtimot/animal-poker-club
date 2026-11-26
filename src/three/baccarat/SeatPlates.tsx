// 百家乐：跟随 3D 座位的名牌（其他玩家）：名字、筹码、押在哪里、结果
import { memo } from 'react';
import { Html } from '@react-three/drei';
import { SPOT_NAME, betTotal } from '../../core/baccarat/rules';
import type { BacSeatView, BaccaratView } from '../../core/baccarat/types';
import { useGame } from '../../store/gameStore';
import { AnimatedChips } from '../../ui/common/AnimatedNumber';
import { SeatAvatar } from '../../ui/game/hud/bits';
import { formatChips } from '../../utils/format';
import type { SeatLayout } from '../layout';
import { Bubble, MoodBadge, clampedPositionBaccarat } from '../scenes/SeatHud';

export function betSummary(p: Pick<BacSeatView, 'bets'>): string {
  return (['player', 'banker', 'tie'] as const)
    .filter((s) => p.bets[s] > 0)
    .map((s) => `${SPOT_NAME[s]} ${formatChips(p.bets[s])}`)
    .join(' · ');
}

export const BacSeatPlate = memo(function BacSeatPlate({ p, view, layout, paid }: { p: BacSeatView; view: BaccaratView; layout: SeatLayout; paid: boolean }) {
  const left = useGame((s) => p.left || (!!s.room && !s.room.solo && !s.room.members.some((m) => m.id === p.id)));
  const offline = !p.connected && !p.isAI && !left;
  const profit = p.returns ? betTotal(p.returns) - betTotal(p.bets) : 0;
  const status = left
    ? { text: '已离开', cls: 'out' }
    : offline
      ? { text: '重新连接中…', cls: 'offline' }
      : p.placed
        ? { text: betSummary(p), cls: 'call' }
        : p.skipped
          ? { text: '这局不下注', cls: 'fold' }
          : view.phase === 'betting'
            ? { text: '选择下注…', cls: 'thinking' }
            : { text: '旁观这一局', cls: 'fold' };
  const balance = view.phase === 'round-end' && !paid && p.returns ? p.balance - betTotal(p.returns) : p.balance;
  const cls = [offline && 'offline', left && 'out', paid && profit > 0 && 'winner'].filter(Boolean).join(' ');
  return (
    <Html position={layout.tag} center zIndexRange={[20, 0]} calculatePosition={clampedPositionBaccarat} style={{ pointerEvents: 'none' }}>
      <div className={`splate bacp ${cls}`}>
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
              <AnimatedChips value={balance} />
            </div>
          </div>
        </div>
        <div className={`sp-status ${status.cls}`}>{status.text}</div>
        {paid && profit !== 0 && <div className={profit > 0 ? 'sp-win' : 'sp-loss'}>{profit > 0 ? `+${formatChips(profit)}` : `−${formatChips(-profit)}`}</div>}
      </div>
    </Html>
  );
});
