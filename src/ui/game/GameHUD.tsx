import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import type { TableView } from '../../core/game/view';
import { session } from '../../net/session';
import { net } from '../../net/netClient';
import { setLocalPaused } from '../../net/localHost';
import { formatChips } from '../../utils/format';
import { Btn, Modal } from '../common/ui';
import { RulesModal } from '../common/RulesModal';
import { ChatPanel } from './ChatPanel';
import { QuickSettings } from '../settings/SettingsScreen';
import { sound } from '../../audio/sound';
import { useFx } from '../../store/fxStore';
import { GameTopBar } from './hud/GameTopBar';
import { PlayerDock } from './hud/PlayerDock';
import { ActionDock } from './hud/ActionDock';
import { WinnerPresentation } from './hud/WinnerPresentation';
import { HandFeed } from './hud/HandFeed';
import './hud/gameHud.css';
import { haptic } from '../../display/haptics';
import { DefeatOverlay } from './hud/DefeatOverlay';
import { BoardRail } from './hud/BoardRail';
import { ConnBanner } from './hud/ConnBanner';
import { useIsPC } from '../../utils/pc';
import { defeatActive, useDefeat } from '../../animation/defeat/defeatStore';

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
  return (
    <div className="next-hand" role="status">
      下一局 {s} 秒后开始…
    </div>
  );
}

function GameOver({ view }: { view: TableView }) {
  const mode = useGame((s) => s.mode);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const go = view.gameOver;
  const [show, setShow] = useState(false);
  // 失败演出进行中：先让演出（包括“出局”画面）播完，再显示结算
  const defeatOn = useDefeat((s) => s.seq !== null);
  useEffect(() => {
    if (!go) return setShow(false);
    const t = setTimeout(() => {
      setShow(true);
      if (!defeatActive()) sound.play(go.winnerId === view.viewerId ? 'win' : 'lose');
    }, 1500);
    return () => clearTimeout(t);
  }, [!!go]); // eslint-disable-line
  if (!go || !show || defeatOn) return null;
  const meWon = go.winnerId === view.viewerId;
  const isHost = room?.hostId === playerId;
  const medal = (n: number) => (n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : `${n}`);
  return (
    <Modal
      title={meWon ? '👑 你是今天的扑克王！' : '🏁 游戏结束'}
      actions={
        <>
          <Btn kind="ghost" onClick={() => session.leave('home')}>
            🏠 返回首页
          </Btn>
          {room?.solo || mode === 'local' ? (
            <>
              <Btn kind="ghost" onClick={() => session.leave('quick')}>
                返回大厅
              </Btn>
              <Btn kind="pink" onClick={() => session.playAgain()}>
                再来一局
              </Btn>
            </>
          ) : (
            <>
              <Btn kind="ghost" onClick={() => session.leave('online')}>
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
          )}
        </>
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
  { icon: '🃏', title: '你的手牌', text: '每局你会拿到 2 张底牌。左下角是你的座位：底牌、当前牌型、筹码，轮到你时会亮起并开始倒计时。' },
  { icon: '🌲', title: '公共牌与底池', text: '桌子中央会依次翻出 3 张翻牌、1 张转牌、1 张河牌，所有玩家共用；底池金额显示在公共牌上方。' },
  { icon: '🪙', title: '行动按钮', text: '轮到你时，右下角会出现「弃牌 / 过牌 / 跟注 / 加注 / 全押」。加注可以拖动滑块或点 2× / ½ 底池 等快捷金额。电脑上也可以用键盘 F / C / R / A。' },
  { icon: '💬', title: '聊天与表情', text: '在聊天窗口发送文字或表情，你的动物会做出对应的动作，比如 😂 大笑、😎 戴上墨镜！' },
  { icon: '🎥', title: '镜头', text: '右上角 🎥 可以切换牌桌视角、玩家视角和自由视角。全押和摊牌时镜头会自动推进（可在设置里关闭）。' },
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
  // 多人在线对局无法暂停：教程弹窗会挡住操作，而行动计时仍在继续（可能被自动弃牌），所以只在可以暂停的对局中显示
  if (mode !== 'local' && !solo) return null;
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
  const [rules, setRules] = useState(false);
  const [settings, setSettings] = useState(false);
  // 手机 / 平板：底部显示清晰的公共牌条（电脑版牌桌上的牌已经足够大）
  const pc = useIsPC();
  // 自己的筹码用完（出局）：手机触感反馈（只在状态变化的那一刻触发一次）
  const busted = !!view.players.find((p) => p.id === view.viewerId)?.busted;
  const wasBusted = useRef(busted);
  useEffect(() => {
    if (busted && !wasBusted.current) haptic('defeat');
    wasBusted.current = busted;
  }, [busted]);
  // 牌局中：提示消息移到底部操作区上方，不挡顶栏与赢家演出
  useEffect(() => {
    document.body.classList.add('in-game');
    return () => document.body.classList.remove('in-game');
  }, []);

  return (
    <div className="screen passthrough game-hud">
      <GameTopBar view={view} onRules={() => setRules(true)} onSettings={() => setSettings(true)} />
      <ConnBanner />
      <HandFeed view={view} />
      <ChatPanel />
      <div className="gdock">
        {!pc && <BoardRail view={view} />}
        <PlayerDock view={view} />
        <ActionDock view={view} />
      </div>
      <WinnerPresentation view={view} />
      <Announcer />
      <NextHandCountdown view={view} />
      <GameOver view={view} />
      {/* 失败演出的画面层（遮幅、闪光、黑屏、“出局”画面） */}
      <DefeatOverlay gameOver={!!view.gameOver} />
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
                onClick={() => session.leave('home')}
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
