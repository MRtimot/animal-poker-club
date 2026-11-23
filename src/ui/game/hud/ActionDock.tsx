// 行动面板：弃牌 / 过牌 / 跟注 / 下注·加注 / 全押。
// 按钮完全由引擎给出的合法动作（view.legal）生成；客户端只发送动作，是否合法由服务器 / 本地主机决定。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TableView } from '../../../core/game/view';
import type { ActionType } from '../../../core/table/types';
import { session } from '../../../net/session';
import { useGame } from '../../../store/gameStore';
import { sound } from '../../../audio/sound';
import { formatChips } from '../../../utils/format';
import { raisePresets, raiseStep, snapRaise, speciesEmoji } from './model';
import { TimerBar } from './bits';
import { turnClock, useServerNow } from './clock';

const PENDING_LABEL: Record<string, string> = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', allin: '全押' };

function Waiting({ view }: { view: TableView }) {
  const me = view.players.find((p) => p.id === view.viewerId);
  const cur = view.players.find((p) => p.id === view.currentPlayerId);
  const now = useServerNow(!!cur);
  const clock = cur ? turnClock(view, now) : null;
  let text = '等待下一局开始…';
  if (me?.busted) text = '你的筹码已用完，正在观战';
  else if (cur) text = `等待 ${cur.name} 行动`;
  else if (view.phase === 'showdown') text = '摊牌中…';
  else if (view.phase !== 'complete' && view.phase !== 'idle') text = '发牌中…';
  const sub = me && !me.busted && me.folded && view.phase !== 'complete' ? '你已弃牌，本局结束后自动进入下一局' : null;
  return (
    <div className="gdock-wait" role="status" aria-live="polite">
      <div className="wait-line">
        {cur && <span className="wait-emoji">{speciesEmoji(cur)}</span>}
        <span>{text}</span>
        {cur && <span className="wait-dots" aria-hidden />}
      </div>
      {cur && clock && view.turnDeadline && <TimerBar clock={clock} deadline={view.turnDeadline} />}
      {sub && <div className="wait-sub">{sub}</div>}
    </div>
  );
}

export function ActionDock({ view }: { view: TableView }) {
  const legal = view.legal;
  const me = view.players.find((p) => p.id === view.viewerId);
  const netPending = useGame((s) => s.pendingAction);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<ActionType | null>(null);
  // ref 立即生效：同一瞬间的连续点击 / 连按键盘只会发出一次动作
  const lock = useRef(false);
  const turnKey = `${view.handNumber}:${view.currentPlayerId}:${legal?.minRaiseTo}:${legal?.callAmount}`;

  // 轮次变化（服务器已处理动作）：解除锁定，重置加注面板
  useEffect(() => {
    lock.current = false;
    setSubmitted(null);
    setRaiseOpen(false);
    setDraft(null);
    if (legal) setAmount(legal.minRaiseTo);
  }, [turnKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 动作被拒绝（例如本地对局里出错）时状态不会变化：稍后自动解锁，避免按钮永久不可用
  useEffect(() => {
    if (!submitted) return;
    const t = setTimeout(() => {
      lock.current = false;
      setSubmitted(null);
    }, 2500);
    return () => clearTimeout(t);
  }, [submitted]);

  const step = raiseStep(view.bigBlind);
  const presets = useMemo(() => (legal ? raisePresets(view, legal) : []), [legal, view.phase, view.currentBet, view.bigBlind, view.potTotal]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = !!submitted || !!netPending;

  const act = (type: ActionType, amt?: number) => {
    if (!legal || lock.current || netPending) return;
    lock.current = true;
    setSubmitted(type);
    sound.play('button');
    session.action({ type, amount: amt });
  };
  const confirmRaise = () => {
    if (!legal) return;
    const v = snapRaise(draft !== null ? Number(draft) : amount, legal, step);
    if (v >= legal.maxRaiseTo) act('allin');
    else act('raise', v);
  };
  const nudge = (dir: 1 | -1) => {
    if (!legal) return;
    setDraft(null);
    setAmount((a) => snapRaise(a + dir * step, legal, step));
  };

  // 键盘：F 弃牌 / C 过牌或跟注 / R 打开加注或确认 / A 全押 / ↑↓ 调整金额 / Enter 确认 / Esc 关闭
  useEffect(() => {
    if (!legal) return;
    const onKey = (e: KeyboardEvent) => {
      // 任何对话框打开时（离开确认、规则、设置、教程…）快捷键都不生效，避免看规则时按到 C 就跟注
      if (e.ctrlKey || e.metaKey || e.altKey || useGame.getState().modal || document.querySelector('.modal-backdrop')) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const inAmount = (e.target as HTMLElement)?.dataset?.raiseInput === '1';
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && !inAmount) return;
      const key = e.key.toLowerCase();
      if (inAmount && key !== 'enter' && key !== 'escape') return;
      if (key === 'f') act('fold');
      else if (key === 'c') act(legal.canCheck ? 'check' : 'call');
      else if (key === 'r' && legal.canRaise) raiseOpen ? confirmRaise() : setRaiseOpen(true);
      else if (key === 'a' && legal.canAllIn) act('allin');
      else if (key === 'enter' && raiseOpen) confirmRaise();
      else if (key === 'escape' && raiseOpen) setRaiseOpen(false);
      else if ((key === 'arrowup' || key === 'arrowright') && raiseOpen) nudge(1);
      else if ((key === 'arrowdown' || key === 'arrowleft') && raiseOpen) nudge(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!me || view.gameOver) return null;
  if (!legal) return <Waiting view={view} />;

  const pendingType = submitted ?? (netPending?.type as ActionType | undefined);
  const word = view.currentBet === 0 ? '下注' : '加注';
  const shown = draft !== null ? draft : String(amount);
  const isAllInAmount = amount >= legal.maxRaiseTo;
  const callAllIn = legal.callAmount >= me.chips;

  return (
    <section className={`gdock-act ${busy ? 'busy' : ''}`} aria-label="行动">
      {raiseOpen && legal.canRaise && (
        <div className="raise-panel" role="group" aria-label={word === '下注' ? '下注金额' : '加注金额'}>
          <div className="raise-head">
            <span className="raise-title">{word === '下注' ? '下注金额' : '加注到'}</span>
            <label className="raise-amount">
              <span className="chip-ico" aria-hidden />
              <input
                data-raise-input="1"
                type="number"
                inputMode="numeric"
                min={legal.minRaiseTo}
                max={legal.maxRaiseTo}
                step={step}
                value={shown}
                aria-label="金额"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft === null) return;
                  setAmount(snapRaise(Number(draft), legal, step));
                  setDraft(null);
                }}
              />
            </label>
            <button type="button" className="raise-close" aria-label="关闭加注面板" onClick={() => setRaiseOpen(false)}>
              ✕
            </button>
          </div>
          <div className="raise-presets">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`${amount === p.to && draft === null ? 'on' : ''} ${p.allIn ? 'allin' : ''}`}
                onClick={() => {
                  setDraft(null);
                  setAmount(p.to);
                  sound.play('chip');
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="raise-slider">
            <button type="button" aria-label="减少" onClick={() => nudge(-1)} disabled={amount <= legal.minRaiseTo}>
              −
            </button>
            <input
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={1}
              value={amount}
              aria-label="加注金额滑块"
              style={{ ['--fill' as string]: `${((amount - legal.minRaiseTo) / Math.max(1, legal.maxRaiseTo - legal.minRaiseTo)) * 100}%` }}
              onChange={(e) => {
                setDraft(null);
                setAmount(snapRaise(Number(e.target.value), legal, step));
              }}
            />
            <button type="button" aria-label="增加" onClick={() => nudge(1)} disabled={amount >= legal.maxRaiseTo}>
              +
            </button>
          </div>
          <div className="raise-range">
            <span>最小 {formatChips(legal.minRaiseTo)}</span>
            <span>最大 {formatChips(legal.maxRaiseTo)}</span>
          </div>
        </div>
      )}
      <div className="act-row">
        <button type="button" className="act act-fold" disabled={busy} onClick={() => act('fold')}>
          <span className="act-label">{pendingType === 'fold' ? '提交中…' : '弃牌'}</span>
          <kbd>F</kbd>
        </button>
        {legal.canCheck ? (
          <button type="button" className="act act-check" disabled={busy} onClick={() => act('check')}>
            <span className="act-label">{pendingType === 'check' ? '提交中…' : '过牌'}</span>
            <kbd>C</kbd>
          </button>
        ) : (
          <button type="button" className="act act-call" disabled={busy || !legal.canCall} onClick={() => act('call')}>
            <span className="act-label">{pendingType === 'call' ? '提交中…' : callAllIn ? '跟注全押' : '跟注'}</span>
            <em>{formatChips(legal.callAmount)}</em>
            <kbd>C</kbd>
          </button>
        )}
        {legal.canRaise && (
          <button
            type="button"
            className={`act act-raise ${raiseOpen ? 'confirm' : ''}`}
            disabled={busy}
            aria-expanded={raiseOpen}
            onClick={() => (raiseOpen ? confirmRaise() : setRaiseOpen(true))}
          >
            <span className="act-label">{pendingType === 'raise' ? '提交中…' : raiseOpen ? (isAllInAmount ? '确认全押' : `确认${word}`) : word}</span>
            {raiseOpen && <em>{formatChips(snapRaise(draft !== null ? Number(draft) : amount, legal, step))}</em>}
            <kbd>R</kbd>
          </button>
        )}
        {legal.canAllIn && (
          <button type="button" className="act act-allin" disabled={busy} onClick={() => act('allin')}>
            <span className="act-label">{pendingType === 'allin' ? '提交中…' : '全押'}</span>
            <em>{formatChips(legal.allInAmount)}</em>
            <kbd>A</kbd>
          </button>
        )}
      </div>
      {netPending && <div className="act-note">{PENDING_LABEL[netPending.type] ?? '动作'}已发送，等待服务器确认…</div>}
    </section>
  );
}
