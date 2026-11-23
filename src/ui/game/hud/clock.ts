// 行动倒计时：截止时间由服务器（或本地主机）决定，客户端只负责显示
import { useEffect, useState } from 'react';
import { useGame } from '../../../store/gameStore';
import type { TableView } from '../../../core/game/view';

/** 服务器时间（毫秒），active 时每 periodMs 刷新一次 */
export function useServerNow(active: boolean, periodMs = 250): number {
  const offset = useGame((s) => s.clockOffset);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => tick((x) => x + 1), periodMs);
    return () => clearInterval(iv);
  }, [active, periodMs]);
  return Date.now() + offset;
}

export type TurnLevel = '' | 'warn' | 'danger' | 'urgent';

export interface TurnClock {
  remaining: number;
  total: number;
  secs: number;
  level: TurnLevel;
  /** 真人玩家的长倒计时才显示秒数（AI 的思考时间很短，不显示数字） */
  human: boolean;
}

export function turnClock(view: Pick<TableView, 'turnDeadline' | 'turnTotalMs'>, now: number): TurnClock | null {
  if (!view.turnDeadline) return null;
  const remaining = Math.max(0, view.turnDeadline - now);
  const total = Math.max(1, view.turnTotalMs);
  const human = total > 6000;
  const level: TurnLevel = !human ? '' : remaining <= 1000 ? 'urgent' : remaining <= 3000 ? 'danger' : remaining <= 5000 ? 'warn' : '';
  return { remaining, total, secs: Math.ceil(remaining / 1000), level, human };
}
