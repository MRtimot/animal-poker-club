// 下注面板：选一个区（闲 / 和 / 庄）→ 点筹码加注 → 确认（每局一次，确认后不能修改）。赔率与抽水直接显示。
// 这里只是草稿与提示，真正的校验由引擎 / 服务器完成。
import { useEffect, useRef, useState } from 'react';
import { NO_BETS, SPOT_NAME, bacBetError, betTotal, type BacBets, type BacSpot } from '../../core/baccarat/rules';
import type { BaccaratView } from '../../core/baccarat/types';
import { DENOMS } from '../../three/chips/Chips';
import { session } from '../../net/session';
import { useGame } from '../../store/gameStore';
import { sound } from '../../audio/sound';
import { haptic } from '../../display/haptics';
import { formatChips } from '../../utils/format';
import { turnClock, useServerNow } from '../game/hud/clock';
import { TimerBar } from '../game/hud/bits';
import { hotkeyBlocked } from '../blackjack/hotkeys';
import { refillCopy } from '../common/refill';
import { addToSpot, bacTableChips, rebetBets, underMin } from './bet';

const chipColor = (v: number) => DENOMS.find((d) => d.value === v)?.color ?? '#555';
const SPOTS: { id: BacSpot; en: string; pays: string; key: string }[] = [
  { id: 'player', en: 'PLAYER', pays: '1:1', key: 'P' },
  { id: 'tie', en: 'TIE', pays: '8:1', key: 'T' },
  { id: 'banker', en: 'BANKER', pays: '1:1 · 抽 5%', key: 'B' },
];

/** 同一次打开页面里记住上一局的下注（离开牌桌后清空） */
let lastBets: BacBets | null = null;
export function forgetLastBacBets() {
  lastBets = null;
}

export function BacBetPanel({ view }: { view: BaccaratView }) {
  const me = view.players.find((p) => p.id === view.viewerId);
  const pending = useGame((s) => s.pendingAction);
  const balance = me?.balance ?? 0;
  const { rules } = view;
  // 每局从空白开始（不自动带入上一局，免得加筹码时不知不觉越押越多）；要沿用上一局就按「重复」/ R
  const [draft, setDraft] = useState<BacBets>(() => ({ ...NO_BETS }));
  const [spot, setSpot] = useState<BacSpot>(() => (lastBets && lastBets.banker > lastBets.player ? 'banker' : 'player'));
  const [sent, setSent] = useState(false);
  const lock = useRef(false);

  // 引擎 / 服务器已经接受（余额或下注变化）：解除锁定
  useEffect(() => {
    lock.current = false;
    setSent(false);
  }, [balance, me?.placed, me?.skipped]);
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
  const total = betTotal(draft);
  const low = underMin(draft, rules);
  const err = total > 0 ? (low.length ? `每个区最低 ${rules.minBet}（${low.map((s) => SPOT_NAME[s]).join('、')}）` : bacBetError(draft, balance, rules)) : null;
  const ready = total > 0 && !err && !sent && !pending;
  const broke = !!me && !me.placed && balance < rules.minBet;
  const chips = bacTableChips(rules);

  const confirm = () => {
    if (!ready || lock.current || !me || me.placed) return;
    lock.current = true;
    setSent(true);
    lastBets = { ...draft };
    sound.play('button');
    haptic('action');
    session.baccarat({ type: 'bet', bets: draft });
  };
  const add = (chip: number) => {
    if (sent) return;
    sound.play('chip');
    haptic('tap');
    setDraft((d) => addToSpot(d, spot, chip, balance, rules));
  };
  const once = (cmd: 'skip' | 'rebuy') => {
    if (lock.current || pending) return;
    lock.current = true;
    setSent(true);
    sound.play('button');
    session.baccarat({ type: cmd });
  };
  const rebet = () => {
    const r = rebetBets(lastBets, balance, rules);
    if (betTotal(r) > 0) setDraft(r);
  };

  // 键盘：P / T / B 选区，1~5 加筹码，R 重复上一局，Backspace 清空，Enter 确认
  useEffect(() => {
    if (!me || me.placed || broke) return;
    const onKey = (e: KeyboardEvent) => {
      if (hotkeyBlocked(e)) return;
      const k = e.key.toLowerCase();
      const i = Number(e.key) - 1;
      const pick = SPOTS.find((s) => s.key.toLowerCase() === k);
      if (pick) setSpot(pick.id);
      else if (chips[i] !== undefined) add(chips[i]);
      else if (k === 'r') rebet();
      else if (e.key === 'Backspace') setDraft({ ...NO_BETS });
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
      <section className="bac-panel bac-bet" aria-label="补充筹码">
        <div className="bac-panel-title">{view.economy === 'profile' ? '金币不足最低下注' : '筹码用完了'}</div>
        <p className="bac-hint">
          每个区最低 {formatChips(rules.minBet)}，你有 {formatChips(balance)}。俱乐部可以免费补给虚拟筹码（不是真钱）。{refill.note}
        </p>
        <button type="button" className="bac-btn primary" disabled={!refill.canRefill || sent || !!pending} onClick={() => once('rebuy')}>
          {refill.button}
        </button>
      </section>
    );
  if (me.placed || me.skipped)
    return (
      <section className="bac-panel bac-wait" role="status" aria-live="polite">
        <div className="bac-panel-title">{me.placed ? '已下注，等待开牌' : '这一局你不下注'}</div>
        <p className="bac-hint">{view.players.some((p) => !p.isAI && p.id !== me.id && p.connected && !p.placed && !p.skipped) ? '等待其他玩家下注…' : '马上停止下注…'}</p>
        {clock && view.turnDeadline && <TimerBar clock={clock} deadline={view.turnDeadline} />}
      </section>
    );
  return (
    <section className="bac-panel bac-bet" aria-label="下注">
      <div className="bac-spots" role="radiogroup" aria-label="下注区">
        {SPOTS.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={spot === s.id} className={`bac-spot ${s.id}${spot === s.id ? ' on' : ''}`} onClick={() => (sound.play('button'), setSpot(s.id))}>
            <span className="bac-spot-zh">{SPOT_NAME[s.id]}</span>
            <span className="bac-spot-en">
              {s.en} <em>{s.pays}</em>
            </span>
            <span className="bac-spot-amt">{draft[s.id] > 0 ? formatChips(draft[s.id]) : '—'}</span>
            <kbd>{s.key}</kbd>
          </button>
        ))}
      </div>
      <div className="bac-chips" role="group" aria-label={`往「${SPOT_NAME[spot]}」加筹码`}>
        {chips.map((c, i) => (
          <button key={c} type="button" className="bac-chip" style={{ ['--chip' as string]: chipColor(c) }} disabled={sent || addToSpot(draft, spot, c, balance, rules) === draft} onClick={() => add(c)} aria-label={`往${SPOT_NAME[spot]}加 ${c}`}>
            <b>{c >= 1000 ? `${c / 1000}K` : c}</b>
            <kbd>{i + 1}</kbd>
          </button>
        ))}
        <button type="button" className="bac-mini" disabled={total === 0 || sent} onClick={() => setDraft({ ...NO_BETS })}>
          清空
        </button>
        <button type="button" className="bac-mini" disabled={sent || !lastBets} onClick={rebet}>
          重复
        </button>
      </div>
      <div className="bac-row">
        {!view.solo && (
          <button type="button" className="bac-btn ghost" disabled={sent || !!pending} onClick={() => once('skip')}>
            这局不下注
          </button>
        )}
        <button type="button" className="bac-btn primary" disabled={!ready} onClick={confirm}>
          {sent || pending ? '提交中…' : total > 0 ? `确认下注 ${formatChips(total)}` : '选择下注区与筹码'}
        </button>
      </div>
      {err ? (
        <div className="bac-err" role="alert">
          {err}
        </div>
      ) : (
        clock && view.turnDeadline && <TimerBar clock={clock} deadline={view.turnDeadline} />
      )}
    </section>
  );
}
