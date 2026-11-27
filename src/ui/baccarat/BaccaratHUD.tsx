// 百家乐界面：顶栏、闲 / 庄牌条与最近结果、自己的座位、下注 / 开牌 / 结果面板、结果演出、规则与外观。
// 所有数字来自视图（引擎 / 服务器）；这里不做任何百家乐判断。
import { DefeatOverlay } from '../game/hud/DefeatOverlay';
import { useEffect, useRef, useState } from 'react';
import { BAC_PHASE_NAME, type BaccaratView } from '../../core/baccarat/types';
import { SPOT_NAME, betTotal } from '../../core/baccarat/rules';
import { WINNER_TITLE, buildBacCine, useBacCine } from '../../animation/baccarat/cineStore';
import { session } from '../../net/session';
import { net } from '../../net/netClient';
import { useGame } from '../../store/gameStore';
import { sound } from '../../audio/sound';
import { formatChips } from '../../utils/format';
import { AnimatedChips } from '../common/AnimatedNumber';
import { Btn, Modal } from '../common/ui';
import { ChatPanel } from '../game/ChatPanel';
import { SeatAvatar } from '../game/hud/bits';
import { ConnBanner } from '../game/hud/ConnBanner';
import { TableTools } from '../game/hud/GameTopBar';
import { QuickSettings } from '../settings/SettingsScreen';
import { hotkeyBlocked } from '../blackjack/hotkeys';
import { BaccaratRulesModal } from './BaccaratRules';
import { BacBetPanel, forgetLastBacBets } from './BetPanel';
import { BacBoard } from './Board';
import { BacCosmetics } from './Cosmetics';
import { BacResultOverlay } from './ResultOverlay';
import '../game/hud/gameHud.css';
import './baccarat.css';

function TopBar({ view, onRules, onSettings, onLook }: { view: BaccaratView; onRules: () => void; onSettings: () => void; onLook: () => void }) {
  const set = useGame((s) => s.set);
  const room = useGame((s) => s.room);
  return (
    <header className="gbar">
      <div className="gbar-left">
        <button type="button" className="gbar-btn" aria-label="离开牌桌" title="离开牌桌" onClick={() => set({ modal: 'leave' })}>
          <span aria-hidden>←</span>
        </button>
        <div className="gbar-brand">
          <span className="gbar-mark" aria-hidden>
            🐾
          </span>
          <span className="gbar-name">动物扑克俱乐部</span>
        </div>
      </div>
      <div className="gbar-center">
        <div className="gbar-meta">
          <span className="gbar-game">BACCARAT</span>
          <span className="gbar-item gbar-round">
            <small>局</small>
            <b>#{Math.max(1, view.round)}</b>
          </span>
          <span className="gbar-item">
            <small>每区</small>
            <b>
              {view.rules.minBet}–{formatChips(view.rules.maxBet)}
            </b>
          </span>
          {room && !room.solo && (
            <span className="gbar-item gbar-room">
              <small>房间</small>
              <b>{room.code}</b>
            </span>
          )}
        </div>
        <span className="bac-phase" aria-label={`当前阶段：${BAC_PHASE_NAME[view.phase]}`}>
          {BAC_PHASE_NAME[view.phase]}
        </span>
      </div>
      <div className="bac-tools">
        <button type="button" className="gbar-btn" aria-label="牌桌外观" title="牌桌外观（只是画面）" onClick={onLook}>
          <span aria-hidden>🎨</span>
        </button>
        <TableTools onRules={onRules} onSettings={onSettings} />
      </div>
    </header>
  );
}

/** 自己的座位：筹码、这一局押在哪里、结果 */
function MySeat({ view }: { view: BaccaratView }) {
  const me = view.players.find((p) => p.id === view.viewerId);
  const paid = useBacCine((s) => s.paidRound === view.roundId);
  if (!me) return null;
  const settled = view.phase === 'round-end' && !!me.returns;
  const balance = settled && !paid ? me.balance - betTotal(me.returns!) : me.balance;
  const profit = settled && paid ? betTotal(me.returns!) - betTotal(me.bets) : null;
  return (
    <section className="bac-me" aria-label="我的座位">
      <div className="bac-id">
        <SeatAvatar p={me} size="lg" />
        <div className="bac-who">
          <div className="me-name">
            <span className="me-name-text">{me.name}</span>
            <span className="me-you">你</span>
          </div>
          <div className="me-chips" aria-label={`${view.economy === 'profile' ? '金币' : '桌上筹码'} ${formatChips(balance)}`}>
            <span className="chip-ico" aria-hidden />
            <AnimatedChips value={balance} />
          </div>
        </div>
      </div>
      <div className="bac-mybets">
        {(['player', 'tie', 'banker'] as const).map((s) => (
          <span key={s} className={`bac-mybet ${s}${me.bets[s] > 0 ? '' : ' none'}`}>
            <i>{SPOT_NAME[s]}</i>
            <b>{me.bets[s] > 0 ? formatChips(me.bets[s]) : '—'}</b>
            {paid && me.returns && me.bets[s] > 0 && <em className={me.returns[s] > me.bets[s] ? 'up' : me.returns[s] === me.bets[s] ? '' : 'down'}>{me.returns[s] > me.bets[s] ? `+${formatChips(me.returns[s] - me.bets[s])}` : me.returns[s] === me.bets[s] ? '退回' : '输'}</em>}
          </span>
        ))}
      </div>
      {profit !== null && profit !== 0 && <span className={`bac-net ${profit > 0 ? 'up' : 'down'}`}>{profit > 0 ? `+${formatChips(profit)}` : `−${formatChips(-profit)}`}</span>}
    </section>
  );
}

/** 停止下注 → 开牌：说明现在在开哪一张，以及按规则补牌 */
function Dealing({ view }: { view: BaccaratView }) {
  const last = [...view.events].reverse().find((e) => e.type === 'rule' || e.type === 'natural' || e.type === 'closed' || e.type === 'card');
  const text =
    view.phase === 'idle'
      ? '牌桌准备中'
      : view.phase === 'result' || view.phase === 'payout' || view.phase === 'round-end'
        ? '结算中'
      : view.phase === 'closed'
        ? '停止下注 · 发牌'
        : last?.type === 'natural'
          ? `例牌 ${last.score}！双方不再补牌`
          : last?.type === 'rule'
            ? `${last.side === 'player' ? '闲' : '庄'} ${last.total} 点：${last.action === 'draw' ? '补第三张' : '停牌'}`
            : '开牌中';
  return (
    <section className="bac-panel bac-wait" role="status" aria-live="polite">
      <div className="bac-panel-title">
        {text}
        <span className="wait-dots" aria-hidden />
      </div>
      <p className="bac-hint">补牌完全按规则，没有人可以选择。</p>
    </section>
  );
}

function RoundEnd({ view }: { view: BaccaratView }) {
  const cine = buildBacCine(view);
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
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => {
      lock.current = false;
      setSent(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [sent]);
  const next = () => {
    if (lock.current || pending || !view.solo) return;
    lock.current = true;
    sound.play('button');
    session.baccarat({ type: 'next' });
    setSent(true);
  };
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
    <section className="bac-panel bac-end" aria-label="本局结果">
      <div className="bac-panel-title">
        {cine ? (
          <>
            <span className={`bac-result ${cine.winner}`}>
              {WINNER_TITLE[cine.winner].zh} {cine.player}:{cine.banker}
            </span>
            {cine.profit !== null && <b className={cine.profit > 0 ? 'up' : cine.profit < 0 ? 'down' : ''}>{cine.profit > 0 ? `+${formatChips(cine.profit)}` : cine.profit < 0 ? `−${formatChips(-cine.profit)}` : '±0'}</b>}
          </>
        ) : (
          '本局结束'
        )}
      </div>
      <div className="bac-row">
        {view.solo ? (
          <>
            <button type="button" className="bac-btn ghost" onClick={() => (sound.play('button'), session.leave('home'))}>
              返回首页
            </button>
            <button type="button" className="bac-btn primary" disabled={!!pending || sent} onClick={next}>
              下一局 <kbd>N</kbd>
            </button>
          </>
        ) : (
          <>
            {isHost && (
              <button type="button" className="bac-btn ghost" onClick={() => (sound.play('button'), net.backToLobby())}>
                全桌返回大厅
              </button>
            )}
            <span className="bac-hint" role="status">
              {secs !== null ? `${secs} 秒后开始下一局…` : '等待下一局…'}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

export function BaccaratHUD({ view }: { view: BaccaratView }) {
  const modal = useGame((s) => s.modal);
  const set = useGame((s) => s.set);
  const mode = useGame((s) => s.mode);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const [rules, setRules] = useState(false);
  const [settings, setSettings] = useState(false);
  const [look, setLook] = useState(false);
  const cineOn = useBacCine((s) => s.cine !== null);
  const me = view.players.find((p) => p.id === view.viewerId);

  // 底部区域的实际高度：手机上聊天与跳过按钮跟着它
  const hud = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => hud.current?.style.setProperty('--bac-dock', `${Math.round(el.offsetHeight)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    document.body.classList.add('in-game', 'in-baccarat');
    return () => {
      document.body.classList.remove('in-game', 'in-baccarat');
      forgetLastBacBets();
    };
  }, []);

  const staked = me?.placed ? betTotal(me.bets) : 0;
  const midRound = (view.phase === 'closed' || view.phase === 'dealing' || view.phase === 'result' || view.phase === 'payout') && staked > 0;
  const isHost = !!room && !room.solo && room.hostId === playerId;

  return (
    <div className="screen passthrough game-hud bac-hud" ref={hud}>
      <TopBar view={view} onRules={() => setRules(true)} onSettings={() => setSettings(true)} onLook={() => setLook(true)} />
      <ConnBanner />
      <BacBoard view={view} />
      <ChatPanel />
      <div className="gdock bac-dock" ref={dock}>
        <MySeat view={view} />
        {view.phase === 'betting' ? <BacBetPanel key={view.roundId} view={view} /> : view.phase === 'round-end' && !cineOn ? <RoundEnd view={view} /> : <Dealing view={view} />}
      </div>
      <BacResultOverlay view={view} />
      {/* 失败演出（与德州共用）：输光 = 完整处决；一局输掉一半以上 = 简短版 */}
      <DefeatOverlay />
      {rules && <BaccaratRulesModal rules={view.rules} onClose={() => setRules(false)} />}
      {look && (
        <Modal title="🎨 牌桌外观" onClose={() => setLook(false)} actions={<Btn onClick={() => setLook(false)}>完成</Btn>}>
          <BacCosmetics />
        </Modal>
      )}
      {settings && (
        <Modal title="⚙️ 设置" onClose={() => setSettings(false)} actions={<Btn onClick={() => setSettings(false)}>完成</Btn>}>
          <QuickSettings />
        </Modal>
      )}
      {modal === 'leave' && (
        <Modal
          title="确定要离开百家乐牌桌吗？"
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
            {midRound ? `这一局已经停止下注：结果已经确定，你的 ${formatChips(staked)} 下注会照常按结果结算。` : mode === 'online' && !room?.solo ? '离开后会退出房间。' : '你的金币、经验和统计都已经保存。'}
          </p>
        </Modal>
      )}
    </div>
  );
}
