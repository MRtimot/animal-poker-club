import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import type { TableView } from '../../core/game/view';
import { PHASE_NAME } from '../../core/table/types';
import { describePartial, evaluateHand } from '../../core/poker/handEvaluator';
import { session } from '../../net/session';
import { net } from '../../net/netClient';
import { restartLocalGame, setLocalPaused, stopLocalGame } from '../../net/localHost';
import { formatChips } from '../../utils/format';
import { Btn, MiniCard, Modal } from '../common/ui';
import { RulesModal } from '../common/RulesModal';
import { ChatPanel } from './ChatPanel';
import { QuickSettings } from '../settings/SettingsScreen';
import { sound } from '../../audio/sound';
import { useFx } from '../../store/fxStore';
import { AnimatedChips } from '../common/AnimatedNumber';

/** 屏幕中央的大字提示：全押！/ 翻牌 / 转牌 / 河牌 / 平局！ */
function Announcer() {
  const a = useFx((s) => s.announce);
  const [visible, setVisible] = useState<number | null>(null);
  useEffect(() => {
    if (!a) return;
    setVisible(a.id);
    const t = setTimeout(() => setVisible((v) => (v === a.id ? null : v)), a.kind === 'street' ? 1300 : 1900);
    return () => clearTimeout(t);
  }, [a?.id]); // eslint-disable-line
  if (!a || visible !== a.id) return null;
  return (
    <div key={a.id} className={`announce announce-${a.kind}`}>
      <span>{a.text}</span>
    </div>
  );
}

function TopBar({ view, onRules, onSettings }: { view: TableView; onRules: () => void; onSettings: () => void }) {
  const cameraMode = useGame((s) => s.cameraMode);
  const set = useGame((s) => s.set);
  const room = useGame((s) => s.room);
  const mode = useGame((s) => s.mode);
  const music = useSettings((s) => s.musicVolume);
  const setS = useSettings((s) => s.set);
  const nextCam = () => {
    const order = ['overview', 'player', 'free'] as const;
    const i = order.indexOf(cameraMode);
    const next = order[(i + 1) % order.length];
    set({ cameraMode: next });
    useGame.getState().toast(next === 'overview' ? '📷 普通视角' : next === 'player' ? '📷 玩家视角' : '📷 自由视角（拖动旋转，滚轮缩放）');
  };
  return (
    <div className="hud-top">
      <button className="icon-btn" title="离开牌桌" onClick={() => useGame.getState().set({ modal: 'leave' })}>
        ←
      </button>
      <div className="panel hud-info">
        {mode === 'online' && room && !room.solo && (
          <span className="hide-sm">
            房间 <b>{room.code}</b>
          </span>
        )}
        <span>
          第 <b>{Math.max(1, view.handNumber)}</b> 局
        </span>
        <span className="phase-pill">{view.handNumber === 0 ? '准备中' : PHASE_NAME[view.phase]}</span>
        <span>
          盲注 <b>{view.smallBlind}/{view.bigBlind}</b>
        </span>
        <span className="hide-sm">
          底池 <b>{formatChips(view.potTotal)}</b>
        </span>
      </div>
      <div className="hud-tools">
        <button className="icon-btn" title="切换视角" onClick={nextCam}>
          {cameraMode === 'overview' ? '🎥' : cameraMode === 'player' ? '👀' : '🕹️'}
        </button>
        <button className="icon-btn" title={music > 0 ? '静音音乐' : '打开音乐'} onClick={() => setS({ musicVolume: music > 0 ? 0 : 0.35 })}>
          {music > 0 ? '🎵' : '🔇'}
        </button>
        <button className="icon-btn" title="游戏规则" onClick={onRules}>
          ❓
        </button>
        <button className="icon-btn" title="设置" onClick={onSettings}>
          ⚙️
        </button>
      </div>
    </div>
  );
}

function MyHand({ view }: { view: TableView }) {
  const me = view.players.find((p) => p.id === view.viewerId);
  const info = useMemo(() => {
    if (!me) return null;
    const hole = me.hole.filter(Boolean) as NonNullable<(typeof me.hole)[number]>[];
    if (hole.length < 2) return null;
    const all = [...hole, ...view.board];
    const best = all.length >= 5 ? evaluateHand(all) : null;
    return { hole, name: best ? best.name : describePartial(hole), bestIds: new Set(best?.cards.map((c) => c.id) ?? []) };
  }, [me, view.board]);
  if (!me) return null;
  return (
    <div className="panel my-hand">
      <div className="cards">
        {info ? info.hole.map((c) => <MiniCard key={c.id} card={c} highlight={view.board.length >= 3 && info.bestIds.has(c.id)} />) : [<MiniCard key="a" card={null} />, <MiniCard key="b" card={null} />]}
      </div>
      <div>
        <div className="label">{me.folded ? '已弃牌' : '当前牌型'}</div>
        <div className="hand-name">{info && !me.folded ? info.name : '—'}</div>
        <div className="mychips">🪙 <AnimatedChips value={me.chips} /></div>
      </div>
    </div>
  );
}

function ActionBar({ view }: { view: TableView }) {
  const legal = view.legal;
  const me = view.players.find((p) => p.id === view.viewerId);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setRaiseOpen(false);
    setPending(false);
    if (legal) setAmount(legal.minRaiseTo);
  }, [legal?.minRaiseTo, legal?.maxRaiseTo, view.currentPlayerId, view.handNumber]); // eslint-disable-line

  const act = (type: 'fold' | 'check' | 'call' | 'raise' | 'allin', amt?: number) => {
    if (!legal || pending) return;
    setPending(true);
    session.action({ type, amount: amt });
    setTimeout(() => setPending(false), 1200);
  };

  // 键盘快捷键
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!legal || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const key = e.key.toLowerCase();
      if (key === 'f') act('fold');
      else if (key === 'c') act(legal.canCheck ? 'check' : 'call');
      else if (key === 'r' && legal.canRaise) {
        if (raiseOpen) act('raise', amount);
        else setRaiseOpen(true);
      } else if (key === 'a' && legal.canAllIn) act('allin');
      else if (key === 'escape') setRaiseOpen(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!me) return null;
  if (view.gameOver) return null;
  if (!legal) {
    const cur = view.players.find((p) => p.id === view.currentPlayerId);
    let text = '等待下一局开始…';
    if (me.busted) text = '你的筹码已用完，正在观战';
    else if (cur) text = `等待 ${cur.name} 行动…`;
    else if (view.phase !== 'complete' && view.phase !== 'idle') text = '发牌中…';
    return (
      <div className="panel actions">
        <div className="waiting">{text}</div>
      </div>
    );
  }

  const pot = view.potTotal;
  const presets: { label: string; to: number }[] = [];
  const add = (label: string, to: number) => {
    const v = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(to)));
    if (!presets.some((p) => p.to === v)) presets.push({ label, to: v });
  };
  add('最小', legal.minRaiseTo);
  if (view.phase === 'preflop' && view.currentBet <= view.bigBlind) add('3 倍盲', view.bigBlind * 3);
  add('½ 底池', view.currentBet + (pot + legal.toCall) * 0.5);
  add('¾ 底池', view.currentBet + (pot + legal.toCall) * 0.75);
  add('底池', view.currentBet + pot + legal.toCall);
  const raiseWord = view.currentBet === 0 ? '下注' : '加注到';
  const isAllInAmount = amount >= legal.maxRaiseTo;

  return (
    <div className="panel actions">
      {raiseOpen && legal.canRaise && (
        <div className="raise-panel">
          <div className="raise-presets">
            {presets.map((p) => (
              <button key={p.label} onClick={() => setAmount(p.to)}>
                {p.label}
              </button>
            ))}
            <button onClick={() => setAmount(legal.maxRaiseTo)}>全押</button>
          </div>
          <div className="row">
            <input
              className="range grow"
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={Math.max(1, Math.round(view.bigBlind / 2))}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            <div className="raise-amount">{formatChips(amount)}</div>
          </div>
        </div>
      )}
      <div className="action-row">
        <Btn kind="red" onClick={() => act('fold')} disabled={pending}>
          弃牌<span className="kbd">F</span>
        </Btn>
        {legal.canCheck ? (
          <Btn kind="ghost" onClick={() => act('check')} disabled={pending}>
            过牌<span className="kbd">C</span>
          </Btn>
        ) : (
          <Btn kind="cyan" onClick={() => act('call')} disabled={pending}>
            跟注<span className="kbd">C</span>
            <small>{legal.callAmount >= me.chips ? '全押 ' : ''}{formatChips(legal.callAmount)}</small>
          </Btn>
        )}
        {legal.canRaise &&
          (raiseOpen ? (
            <Btn kind="green" onClick={() => act(isAllInAmount ? 'allin' : 'raise', amount)} disabled={pending}>
              确认{isAllInAmount ? '全押' : raiseWord === '下注' ? '下注' : '加注'}
              <small>{formatChips(amount)}</small>
            </Btn>
          ) : (
            <Btn kind="green" onClick={() => setRaiseOpen(true)} disabled={pending}>
              {view.currentBet === 0 ? '下注' : '加注'}
              <span className="kbd">R</span>
            </Btn>
          ))}
        {legal.canAllIn && (
          <Btn kind="pink" onClick={() => act('allin')} disabled={pending}>
            全押<span className="kbd">A</span>
            <small>{formatChips(legal.allInAmount)}</small>
          </Btn>
        )}
      </div>
    </div>
  );
}

function ResultBanner({ view }: { view: TableView }) {
  const [show, setShow] = useState<number | null>(null);
  const summary = view.summary;
  useEffect(() => {
    if (view.phase !== 'complete' || !summary) return;
    const delay = summary.uncontested ? 700 : 2900;
    const t = setTimeout(() => setShow(summary.handNumber), delay);
    const t2 = setTimeout(() => setShow(null), delay + 3200);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [summary?.handNumber, view.phase]); // eslint-disable-line
  if (!summary || show !== summary.handNumber || view.gameOver) return null;
  const meWin = summary.winners.find((w) => w.playerId === view.viewerId);
  const nameOf = (id: string) => (id === view.viewerId ? '你' : view.players.find((p) => p.id === id)?.name ?? '玩家');
  return (
    <div className={`panel result-banner ${meWin ? 'me-win' : ''}`}>
      <div className="big">{meWin ? '🎉 你赢了！' : new Set(summary.winners.map((w) => w.playerId)).size > 1 ? '🤝 平局！平分底池' : `🏆 ${nameOf(summary.winners[0].playerId)} 获胜`}</div>
      {summary.winners.map((w) => (
        <div className="line" key={w.playerId}>
          {nameOf(w.playerId)} {w.handName ? `以「${w.handName}」` : ''}赢得 <b className="gold">{formatChips(w.amount)}</b> 筹码
          {summary.uncontested ? '（其他玩家都弃牌了）' : ''}
        </div>
      ))}
    </div>
  );
}

function NextHandCountdown({ view }: { view: TableView }) {
  const offset = useGame((s) => s.clockOffset);
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(iv);
  }, []);
  if (!view.nextHandAt || view.gameOver) return null;
  const s = Math.ceil((view.nextHandAt - (Date.now() + offset)) / 1000);
  if (s <= 0 || s > 4) return null;
  return <div className="next-hand">下一局 {s} 秒后开始…</div>;
}

function GameOver({ view }: { view: TableView }) {
  const mode = useGame((s) => s.mode);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const setScreen = useGame((s) => s.setScreen);
  const go = view.gameOver;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!go) return setShow(false);
    const t = setTimeout(() => {
      setShow(true);
      sound.play(go.winnerId === view.viewerId ? 'win' : 'lose');
    }, 1500);
    return () => clearTimeout(t);
  }, [!!go]); // eslint-disable-line
  if (!go || !show) return null;
  const meWon = go.winnerId === view.viewerId;
  const isHost = room?.hostId === playerId;
  const medal = (n: number) => (n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : `${n}`);
  return (
    <Modal
      title={meWon ? '👑 你是今天的扑克王！' : '🏁 游戏结束'}
      actions={
        room?.solo ? (
          <>
            <Btn
              kind="ghost"
              onClick={() => {
                net.leaveRoom();
                setScreen('quick');
              }}
            >
              返回大厅
            </Btn>
            <Btn kind="pink" onClick={() => net.restartSolo()}>
              再来一局
            </Btn>
          </>
        ) : mode === 'local' ? (
          <>
            <Btn
              kind="ghost"
              onClick={() => {
                stopLocalGame();
                useGame.getState().set({ mode: null, view: null });
                setScreen('quick');
              }}
            >
              返回大厅
            </Btn>
            <Btn kind="pink" onClick={() => restartLocalGame()}>
              再来一局
            </Btn>
          </>
        ) : (
          <>
            <Btn
              kind="ghost"
              onClick={() => {
                net.leaveRoom();
                setScreen('online');
              }}
            >
              离开房间
            </Btn>
            {isHost ? (
              <Btn kind="pink" onClick={() => net.backToLobby()}>
                返回房间大厅
              </Btn>
            ) : (
              <span className="muted small" style={{ alignSelf: 'center' }}>
                等待房主返回房间大厅…
              </span>
            )}
          </>
        )
      }
    >
      <div className="muted small" style={{ marginBottom: 12 }}>
        共进行了 {view.handNumber} 手牌
      </div>
      {go.rankings.map((r) => (
        <div key={r.playerId} className={`rank-row ${r.playerId === view.viewerId ? 'me' : ''}`}>
          <div className="place">{medal(r.place)}</div>
          <div className="grow" style={{ fontWeight: 800 }}>
            {r.name}
            {r.playerId === view.viewerId ? '（你）' : ''}
          </div>
          <div className="gold">🪙 {formatChips(r.chips)}</div>
        </div>
      ))}
    </Modal>
  );
}

const TUTORIAL = [
  { icon: '🃏', title: '你的手牌', text: '每局你会拿到 2 张底牌，左下角会显示你的底牌和当前能组成的最大牌型。' },
  { icon: '🌲', title: '公共牌', text: '桌子中央会依次翻出 3 张翻牌、1 张转牌、1 张河牌，所有玩家共用。' },
  { icon: '🪙', title: '行动按钮', text: '轮到你时，右下角会出现「弃牌 / 过牌 / 跟注 / 加注 / 全押」。电脑上也可以用键盘 F / C / R / A。' },
  { icon: '💬', title: '聊天与表情', text: '在聊天窗口发送文字或表情，你的动物会做出对应的动作，比如 😂 大笑、😎 戴上墨镜！' },
  { icon: '🎥', title: '镜头', text: '右上角 🎥 可以切换普通视角、玩家视角和自由视角。全押和摊牌时镜头会自动推进。' },
];

function Tutorial() {
  const done = useSettings((s) => s.tutorialDone);
  const setS = useSettings((s) => s.set);
  const mode = useGame((s) => s.mode);
  const [step, setStep] = useState(0);
  const solo = useGame((s) => !!s.room?.solo);
  useEffect(() => {
    if (done) return;
    if (mode === 'local') setLocalPaused(true);
    if (solo) net.pause(true);
    return () => {
      setLocalPaused(false);
      if (solo) net.pause(false);
    };
  }, [done, mode, solo]);
  if (done) return null;
  const s = TUTORIAL[step];
  const finish = () => {
    setS({ tutorialDone: true });
    setLocalPaused(false);
    if (solo) net.pause(false);
  };
  return (
    <Modal
      title={`新手教程 ${step + 1}/${TUTORIAL.length}`}
      actions={
        <>
          <Btn kind="ghost" onClick={finish}>
            跳过
          </Btn>
          {step < TUTORIAL.length - 1 ? <Btn onClick={() => setStep(step + 1)}>下一步</Btn> : <Btn kind="pink" onClick={finish}>开始游戏！</Btn>}
        </>
      }
    >
      <div className="tutorial-step">
        <div className="big">{s.icon}</div>
        <h3 className="center" style={{ margin: '8px 0' }}>
          {s.title}
        </h3>
        <p className="center muted">{s.text}</p>
      </div>
    </Modal>
  );
}

export function GameHUD({ view }: { view: TableView }) {
  const modal = useGame((s) => s.modal);
  const set = useGame((s) => s.set);
  const mode = useGame((s) => s.mode);
  const conn = useGame((s) => s.conn);
  const [rules, setRules] = useState(false);
  const [settings, setSettings] = useState(false);

  return (
    <div className="screen passthrough">
      <TopBar view={view} onRules={() => setRules(true)} onSettings={() => setSettings(true)} />
      {mode === 'online' && conn !== 'connected' && <div className="conn-banner">⚠️ 与服务器的连接已断开，正在重新连接…</div>}
      <ChatPanel />
      <div className="hud-bottom">
        <MyHand view={view} />
        <ActionBar view={view} />
      </div>
      <ResultBanner view={view} />
      <Announcer />
      <NextHandCountdown view={view} />
      <GameOver view={view} />
      <Tutorial />
      {rules && <RulesModal onClose={() => setRules(false)} />}
      {settings && (
        <Modal title="⚙️ 设置" onClose={() => setSettings(false)} actions={<Btn onClick={() => setSettings(false)}>完成</Btn>}>
          <QuickSettings />
        </Modal>
      )}
      {modal === 'leave' && (
        <Modal
          title="确定要离开牌桌吗？"
          onClose={() => set({ modal: null })}
          actions={
            <>
              <Btn kind="ghost" onClick={() => set({ modal: null })}>
                继续游戏
              </Btn>
              <Btn
                kind="red"
                onClick={() => {
                  set({ modal: null });
                  session.leave();
                }}
              >
                离开
              </Btn>
            </>
          }
        >
          <p className="muted">{mode === 'online' ? '离开后你在本局中的手牌会自动弃牌，并退出房间。' : '当前的对局进度将不会保存。'}</p>
        </Modal>
      )}
    </div>
  );
}
