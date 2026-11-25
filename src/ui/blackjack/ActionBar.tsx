// 行动按钮：只显示引擎给出的合法动作（要牌 / 停牌 / 加倍 / 分牌）。每次点击带行动令牌，连点 / 重发不会多发牌
import { useEffect, useRef, useState } from 'react';
import { BJ_ACTION_NAME, type BjAction, type BlackjackView } from '../../core/blackjack/types';
import { session } from '../../net/session';
import { useGame } from '../../store/gameStore';
import { sound } from '../../audio/sound';
import { haptic } from '../../display/haptics';
import { formatChips } from '../../utils/format';
import { TimerBar } from '../game/hud/bits';
import { turnClock, useServerNow } from '../game/hud/clock';
import { hotkeyBlocked } from './hotkeys';

const KEYS: Record<BjAction, string> = { hit: 'H', stand: 'S', double: 'D', split: 'P' };
const EN: Record<BjAction, string> = { hit: 'HIT', stand: 'STAND', double: 'DOUBLE', split: 'SPLIT' };

/** ready：最新一张牌已经翻开（还没看到牌之前不让再点，防止连点误要牌） */
export function ActionBar({ view, ready }: { view: BlackjackView; ready: boolean }) {
  const legal = view.legal;
  const pending = useGame((s) => s.pendingAction);
  const [sent, setSent] = useState<BjAction | null>(null);
  const lock = useRef(false);
  // 令牌变化 = 上一个动作已经执行：解锁
  useEffect(() => {
    lock.current = false;
    setSent(null);
  }, [view.token]);
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => {
      lock.current = false;
      setSent(null);
    }, 2500);
    return () => clearTimeout(t);
  }, [sent]);

  const busy = !!sent || !!pending || !ready;
  const act = (a: BjAction) => {
    if (!legal || !legal[a] || lock.current || pending || !ready) return;
    lock.current = true;
    setSent(a);
    sound.play('button');
    haptic('action');
    session.blackjack({ type: a });
  };
  useEffect(() => {
    if (!legal) return;
    const onKey = (e: KeyboardEvent) => {
      if (hotkeyBlocked(e)) return;
      const a = (Object.keys(KEYS) as BjAction[]).find((k) => KEYS[k].toLowerCase() === e.key.toLowerCase());
      if (!a || !legal[a]) return;
      act(a);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const now = useServerNow(view.turnDeadline !== null);
  const clock = view.turnDeadline ? turnClock(view, now) : null;
  if (!legal) return null;
  const list = (['hit', 'stand', 'double', 'split'] as BjAction[]).filter((a) => legal[a]);
  return (
    <section className={`bj-panel bj-act${busy ? ' busy' : ''}`} aria-label="行动">
      <div className={`bj-acts n${list.length}`}>
        {list.map((a) => (
          <button key={a} type="button" className={`bj-action ${a}`} disabled={busy} onClick={() => act(a)}>
            <span className="bj-action-zh">{sent === a ? '提交中…' : BJ_ACTION_NAME[a]}</span>
            <span className="bj-action-en">
              {EN[a]}
              {(a === 'double' || a === 'split') && <em> +{formatChips(legal.cost)}</em>}
            </span>
            <kbd>{KEYS[a]}</kbd>
          </button>
        ))}
      </div>
      {clock && view.turnDeadline && <TimerBar clock={clock} deadline={view.turnDeadline} />}
    </section>
  );
}
