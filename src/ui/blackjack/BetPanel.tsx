// 下注面板：点筹码加注、加减、清空、重复上一局、最大、确认；余额不够时补给。真正的校验由引擎 / 服务器完成
import { refillCopy } from '../common/refill';
import { useEffect, useRef, useState } from 'react';
import type { BlackjackView } from '../../core/blackjack/types';
import { betError } from '../../core/blackjack/rules';
import { DENOMS } from '../../three/chips/Chips';
import { session } from '../../net/session';
import { useGame } from '../../store/gameStore';
import { sound } from '../../audio/sound';
import { haptic } from '../../display/haptics';
import { formatChips } from '../../utils/format';
import { turnClock, useServerNow } from '../game/hud/clock';
import { TimerBar } from '../game/hud/bits';
import { addChip, nudgeBet, rebetAmount, tableChips } from './bet';
import { hotkeyBlocked } from './hotkeys';

const chipColor = (v: number) => DENOMS.find((d) => d.value === v)?.color ?? '#555';

/** 同一次打开页面里记住上一局的下注（离开牌桌后清空） */
let lastBet = 0;
export function forgetLastBet() {
  lastBet = 0;
}

export function BetPanel({ view }: { view: BlackjackView }) {
  const me = view.players.find((p) => p.id === view.viewerId);
  const pending = useGame((s) => s.pendingAction);
  const balance = me?.balance ?? 0;
  const { rules } = view;
  // 余额够时默认带上一局的下注，直接确认即可（每一局是新的面板：BlackjackHUD 用局号做 key）
  const [draft, setDraft] = useState(() => rebetAmount(lastBet, balance, rules));
  const [sent, setSent] = useState(false);
  const lock = useRef(false);

  // 引擎 / 服务器已经接受（余额或下注变化）：解除锁定
  useEffect(() => {
    lock.current = false;
    setSent(false);
  }, [balance, me?.bet, me?.skipped]);
  // 被拒绝 / 网络异常：稍后自动解锁，按钮不会永久不可用
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => {
      lock.current = false;
      setSent(false);
    }, 2500);
    return () => clearTimeout(t);
  }, [sent]);

  const now = useServerNow(view.turnDeadline !== null);
  const clock = view.turnDeadline ? turnClock(view, now) : null;
  const err = draft > 0 ? betError(draft, balance, rules) : null;
  const ready = draft > 0 && !err && !sent && !pending;
  const waiting = !!me && (me.bet > 0 || me.skipped);
  const broke = !!me && me.bet === 0 && balance < rules.minBet;

  const confirm = () => {
    if (!ready || lock.current || waiting) return;
    lock.current = true;
    setSent(true);
    lastBet = draft;
    sound.play('button');
    haptic('action');
    session.blackjack({ type: 'bet', amount: draft });
  };
  const add = (chip: number) => {
    if (waiting || sent) return;
    sound.play('chip');
    haptic('tap');
    setDraft((d) => addChip(d, chip, balance, rules));
  };
  const once = (cmd: 'skip' | 'rebuy') => {
    if (lock.current || pending) return;
    lock.current = true;
    setSent(true);
    sound.play('button');
    session.blackjack({ type: cmd });
  };

  const chips = tableChips(rules);
  // 键盘：1~5 加筹码、↑↓ 加减、Backspace 清空、Enter 确认
  useEffect(() => {
    if (waiting || broke) return;
    const onKey = (e: KeyboardEvent) => {
      if (hotkeyBlocked(e)) return;
      const i = Number(e.key) - 1;
      if (chips[i] !== undefined) add(chips[i]);
      else if (e.key === 'ArrowUp') setDraft((d) => nudgeBet(d, 1, balance, rules));
      else if (e.key === 'ArrowDown') setDraft((d) => nudgeBet(d, -1, balance, rules));
      else if (e.key === 'Backspace') setDraft(0);
      else if (e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('button')) confirm();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!me) return null;
  const refill = refillCopy(view);
  if (broke)
    return (
      <section className="bj-panel bj-bet" aria-label="补充筹码">
        <div className="bj-panel-title">{view.economy === 'profile' ? '金币不足最低下注' : '筹码用完了'}</div>
        <p className="bj-hint">
          最低下注 {formatChips(rules.minBet)}，你有 {formatChips(balance)}。俱乐部可以免费补给虚拟筹码（不是真钱）。{refill.note}
        </p>
        <button type="button" className="bj-btn primary" disabled={!refill.canRefill || sent || !!pending} onClick={() => once('rebuy')}>
          {refill.button}
        </button>
      </section>
    );
  if (waiting)
    return (
      <section className="bj-panel bj-wait" role="status" aria-live="polite">
        <div className="bj-panel-title">{me.bet > 0 ? `已下注 ${formatChips(me.bet)}` : '这一局你不下注'}</div>
        <p className="bj-hint">{view.players.some((p) => !p.isAI && p.id !== me.id && p.connected && !p.bet && !p.skipped) ? '等待其他玩家下注…' : me.bet > 0 ? '马上发牌…' : '等待有人下注…'}</p>
        {clock && view.turnDeadline && <TimerBar clock={clock} deadline={view.turnDeadline} />}
      </section>
    );
  return (
    <section className="bj-panel bj-bet" aria-label="下注">
      <div className="bj-bet-head">
        <span className="bj-limits">
          限额 {formatChips(rules.minBet)} – {formatChips(rules.maxBet)}
        </span>
        <div className="bj-amount" role="group" aria-label="下注金额">
          <button type="button" aria-label="减少下注" disabled={draft <= 0 || sent} onClick={() => setDraft((d) => nudgeBet(d, -1, balance, rules))}>
            −
          </button>
          <output className={err ? 'bad' : ''} aria-live="polite">
            <span className="chip-ico" aria-hidden />
            {formatChips(draft)}
          </output>
          <button type="button" aria-label="增加下注" disabled={sent || draft >= Math.min(balance, rules.maxBet)} onClick={() => setDraft((d) => nudgeBet(d, 1, balance, rules))}>
            +
          </button>
        </div>
      </div>
      <div className="bj-chips" role="group" aria-label="筹码">
        {chips.map((c, i) => (
          <button key={c} type="button" className="bj-chip" style={{ ['--chip' as string]: chipColor(c) }} disabled={sent || draft + c > Math.min(balance, rules.maxBet)} onClick={() => add(c)} aria-label={`加 ${c}`}>
            <b>{c >= 1000 ? `${c / 1000}K` : c}</b>
            <kbd>{i + 1}</kbd>
          </button>
        ))}
        <button type="button" className="bj-mini" disabled={draft === 0 || sent} onClick={() => setDraft(0)}>
          清空
        </button>
        <button type="button" className="bj-mini" disabled={sent} onClick={() => setDraft(Math.min(balance, rules.maxBet))}>
          最大
        </button>
      </div>
      <div className="bj-row">
        {!view.solo && (
          <button type="button" className="bj-btn ghost" disabled={sent || !!pending} onClick={() => once('skip')}>
            这局不下注
          </button>
        )}
        <button type="button" className="bj-btn primary" disabled={!ready} onClick={confirm}>
          {sent || pending ? '提交中…' : draft > 0 ? `确认下注 ${formatChips(draft)}` : '请选择筹码'}
        </button>
      </div>
      {err ? (
        <div className="bj-err" role="alert">
          {err}
        </div>
      ) : (
        clock && view.turnDeadline && <TimerBar clock={clock} deadline={view.turnDeadline} />
      )}
    </section>
  );
}
