// 21 点界面：顶栏、庄家、自己的手牌、下注 / 行动 / 结果面板、结果演出。
// 所有数字来自视图（引擎 / 服务器）；这里不做任何 21 点判断。
import { DefeatOverlay } from '../game/hud/DefeatOverlay';
import { useEffect, useRef, useState } from 'react';
import { BJ_PHASE_NAME, type BlackjackView } from '../../core/blackjack/types';
import { OUTCOME_TITLE, buildCine, useBjCine } from '../../animation/blackjack/cineStore';
import { session } from '../../net/session';
import { net } from '../../net/netClient';
import { useGame } from '../../store/gameStore';
import { sound } from '../../audio/sound';
import { formatChips } from '../../utils/format';
import { Btn, Modal } from '../common/ui';
import { ChatPanel } from '../game/ChatPanel';
import { TimerBar } from '../game/hud/bits';
import { turnClock, useServerNow } from '../game/hud/clock';
import { ConnBanner } from '../game/hud/ConnBanner';
import { TableTools } from '../game/hud/GameTopBar';
import { QuickSettings } from '../settings/SettingsScreen';
import { ActionBar } from './ActionBar';
import { BetPanel, forgetLastBet } from './BetPanel';
import { BlackjackRulesModal } from './BlackjackRules';
import { DealerStrip } from './DealerStrip';
import { HandPanel } from './HandPanel';
import { ResultOverlay } from './ResultOverlay';
import { hotkeyBlocked } from './hotkeys';
import { usePresentedCards } from './presented';
import '../game/hud/gameHud.css';
import './blackjack.css';

function TopBar({ view, onRules, onSettings }: { view: BlackjackView; onRules: () => void; onSettings: () => void }) {
  const set = useGame((s) => s.set);
  const room = useGame((s) => s.room);
  return (
    <header className="gbar">
      <div className="gbar-left">
        <button type="button" className="gbar-btn" aria-label="离开牌桌" title="离开牌桌" onClick={() => set({ modal: 'leave' })}>
          <span aria-hidden>←</span>
        </button>
        <div className="gbar-brand with-virtual">
          <span className="gbar-mark" aria-hidden>
            🐾
          </span>
          <span className="gbar-brand-text">
            <span className="gbar-name">动物扑克俱乐部</span>
            <span className="gbar-virtual">VIRTUAL GAME · 虚拟金币</span>
          </span>
        </div>
      </div>
      <div className="gbar-center">
        <div className="gbar-meta">
          <span className="gbar-game">BLACKJACK 21</span>
          <span className="gbar-item gbar-round">
            <small>局</small>
            <b>#{Math.max(1, view.round)}</b>
          </span>
          <span className="gbar-item">
            <small>限额</small>
            <b>
              {view.rules.minBet}–{view.rules.maxBet}
            </b>
          </span>
          {room && !room.solo && (
            <span className="gbar-item gbar-room">
              <small>房间</small>
              <b>{room.code}</b>
            </span>
          )}
        </div>
        <span className="bj-phase" aria-label={`当前阶段：${BJ_PHASE_NAME[view.phase]}`}>
          {BJ_PHASE_NAME[view.phase]}
        </span>
      </div>
      <TableTools onRules={onRules} onSettings={onSettings} />
    </header>
  );
}

/** 等待：发牌中 / 别人行动 / 庄家行动 / 旁观 */
function Waiting({ view }: { view: BlackjackView }) {
  const cur = view.players.find((p) => p.id === view.currentPlayerId);
  const me = view.players.find((p) => p.id === view.viewerId);
  const now = useServerNow(view.turnDeadline !== null);
  const clock = view.turnDeadline ? turnClock(view, now) : null;
  const text =
    view.phase === 'idle' ? '牌桌准备中' : view.phase === 'dealing' ? '发牌中' : view.phase === 'dealer-turn' ? `${view.dealer.profile.name} 亮牌` : view.phase === 'round-end' ? '结算中' : cur && cur.id !== view.viewerId ? `等待 ${cur.name} 行动` : '请稍候';
  return (
    <section className="bj-panel bj-wait" role="status" aria-live="polite">
      <div className="bj-panel-title">
        {text}
        <span className="wait-dots" aria-hidden />
      </div>
      {me && !me.hands.length && view.phase !== 'idle' && <p className="bj-hint">你这一局没有下注，正在旁观</p>}
      {clock && view.turnDeadline && <TimerBar clock={clock} deadline={view.turnDeadline} />}
    </section>
  );
}

/** 一局结束：结果小结 + 下一局 */
function RoundEnd({ view }: { view: BlackjackView }) {
  const cine = buildCine(view);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const pending = useGame((s) => s.pendingAction);
  const offset = useGame((s) => s.clockOffset);
  const lock = useRef(false);
  const [sent, setSent] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!view.nextRoundAt) return;
    const iv = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(iv);
  }, [view.nextRoundAt]);
  const next = () => {
    if (lock.current || pending || !view.solo) return;
    lock.current = true;
    sound.play('button');
    session.blackjack({ type: 'next' });
    setSent(true);
  };
  // 没有进入下一局（被拒绝 / 网络异常）：稍后解锁，按钮不会永久不可用
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => {
      lock.current = false;
      setSent(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [sent]);
  useEffect(() => {
    if (!view.solo) return;
    const onKey = (e: KeyboardEvent) => {
      if (hotkeyBlocked(e)) return;
      if (e.key.toLowerCase() === 'n' || (e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('button'))) {
        next();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const secs = view.nextRoundAt ? Math.max(0, Math.ceil((view.nextRoundAt - (Date.now() + offset)) / 1000)) : null;
  const isHost = !!room && !room.solo && room.hostId === playerId;
  return (
    <section className="bj-panel bj-end" aria-label="本局结果">
      <div className="bj-panel-title">
        {cine ? (
          <>
            <span className={`bj-result ${cine.outcome}`}>{OUTCOME_TITLE[cine.outcome].zh}</span>
            <b className={cine.profit > 0 ? 'up' : cine.profit < 0 ? 'down' : ''}>{cine.profit > 0 ? `+${formatChips(cine.profit)}` : cine.profit < 0 ? `−${formatChips(-cine.profit)}` : '±0'}</b>
          </>
        ) : (
          '本局结束'
        )}
      </div>
      <div className="bj-row">
        {view.solo ? (
          <>
            <button type="button" className="bj-btn ghost" onClick={() => (sound.play('button'), session.leave('home'))}>
              返回首页
            </button>
            <button type="button" className="bj-btn primary" disabled={!!pending || sent} onClick={next}>
              下一局 <kbd>N</kbd>
            </button>
          </>
        ) : (
          <>
            {isHost && (
              <button type="button" className="bj-btn ghost" onClick={() => (sound.play('button'), net.backToLobby())}>
                全桌返回大厅
              </button>
            )}
            <span className="bj-hint" role="status">
              {secs !== null ? `${secs} 秒后开始下一局…` : '等待下一局…'}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

export function BlackjackHUD({ view }: { view: BlackjackView }) {
  const modal = useGame((s) => s.modal);
  const set = useGame((s) => s.set);
  const mode = useGame((s) => s.mode);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const [rules, setRules] = useState(false);
  const [settings, setSettings] = useState(false);
  const paid = useBjCine((s) => s.paidRound === view.roundId);
  const cineOn = useBjCine((s) => s.cine !== null);
  const me = view.players.find((p) => p.id === view.viewerId);
  const hand = me?.hands.find((h) => h.id === view.currentHandId);
  // 从发牌起就跟踪自己所有的牌：轮到自己时已经看到牌了，可以马上行动
  const shown = usePresentedCards(view, view.viewerId, me?.hands.flatMap((h) => h.cards) ?? []);
  const ready = !!hand && hand.cards.every((c) => shown.has(c.uid));

  // 底部区域的实际高度（含安全区）：手机上聊天与跳过按钮跟着它
  const hud = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => hud.current?.style.setProperty('--bj-dock', `${Math.round(el.offsetHeight)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    document.body.classList.add('in-game', 'in-blackjack');
    return () => {
      document.body.classList.remove('in-game', 'in-blackjack');
      forgetLastBet();
    };
  }, []);

  const staked = me ? me.hands.reduce((s, h) => s + h.bet, 0) : 0;
  const midRound = view.phase !== 'betting' && view.phase !== 'round-end' && view.phase !== 'idle' && staked > 0;
  const isHost = !!room && !room.solo && room.hostId === playerId;

  return (
    <div className="screen passthrough game-hud bj-hud" ref={hud}>
      <TopBar view={view} onRules={() => setRules(true)} onSettings={() => setSettings(true)} />
      <ConnBanner />
      <DealerStrip view={view} />
      <ChatPanel />
      <div className="gdock bj-dock" ref={dock}>
        {me && <HandPanel view={view} me={me} paid={paid} />}
        {view.phase === 'betting' ? <BetPanel key={view.roundId} view={view} /> : view.phase === 'round-end' && !cineOn ? <RoundEnd view={view} /> : view.legal ? <ActionBar view={view} ready={ready} /> : <Waiting view={view} />}
      </div>
      <ResultOverlay view={view} />
      {/* 失败演出（与德州共用）：输光 = 完整处决；一局输掉一半以上 = 简短版 */}
      <DefeatOverlay />
      {rules && <BlackjackRulesModal rules={view.rules} onClose={() => setRules(false)} />}
      {settings && (
        <Modal title="⚙️ 设置" onClose={() => setSettings(false)} actions={<Btn onClick={() => setSettings(false)}>完成</Btn>}>
          <QuickSettings />
        </Modal>
      )}
      {modal === 'leave' && (
        <Modal
          title="确定要离开 21 点牌桌吗？"
          onClose={() => set({ modal: null })}
          actions={
            <>
              <Btn kind="ghost" onClick={() => set({ modal: null })}>
                继续游戏
              </Btn>
              {isHost && !midRound && (
                <Btn
                  kind="ghost"
                  onClick={() => {
                    set({ modal: null });
                    net.backToLobby();
                  }}
                >
                  全桌返回大厅
                </Btn>
              )}
              <Btn kind="red" onClick={() => session.leave('home')}>
                离开
              </Btn>
            </>
          }
        >
          <p className="muted">
            {midRound ? `这一局还没结束：现在离开会放弃桌上的 ${formatChips(staked)} 下注。` : mode === 'online' && !room?.solo ? '离开后会退出房间。' : '你的金币、经验和统计都已经保存。'}
          </p>
        </Modal>
      )}
    </div>
  );
}
