// 牌局顶栏（游戏内导航）：离开、品牌、牌局信息（第几局 / 盲注 / 房间）、阶段进度、工具按钮
import type { TableView } from '../../../core/game/view';
import { PHASE_NAME } from '../../../core/table/types';
import { STREET_STEPS } from '../../../core/table/stateMachine';
import { useGame } from '../../../store/gameStore';
import { useSettings } from '../../../store/settingsStore';
import { sound } from '../../../audio/sound';
import { formatChips } from '../../../utils/format';
import { useIsPC } from '../../../utils/pc';
import { FullscreenButton } from '../../common/FullscreenUI';

const CAMERA_ORDER = ['overview', 'player', 'free'] as const;
const CAMERA_LABEL = { overview: '牌桌视角', player: '玩家视角', free: '自由视角（拖动旋转，滚轮缩放）' } as const;

function PhaseSteps({ view }: { view: TableView }) {
  const idx = STREET_STEPS.indexOf(view.phase);
  const done = view.phase === 'complete';
  const label = view.handNumber === 0 || view.phase === 'idle' ? '准备中' : done ? '本局结束' : PHASE_NAME[view.phase];
  return (
    <div className="gbar-phase" aria-label={`当前阶段：${label}`}>
      <ol className="gbar-steps" aria-hidden>
        {STREET_STEPS.map((s, i) => (
          <li key={s} className={done || i < idx ? 'past' : i === idx ? 'now' : ''}>
            <span>{PHASE_NAME[s]}</span>
          </li>
        ))}
      </ol>
      <span className="gbar-phase-now">{label}</span>
    </div>
  );
}

/** 顶栏右侧的工具：视角、音乐、规则、全屏、设置（德州扑克与 21 点共用） */
export function TableTools({ onRules, onSettings }: { onRules: () => void; onSettings: () => void }) {
  const cameraMode = useGame((s) => s.cameraMode);
  const set = useGame((s) => s.set);
  // 全部静音时音乐也算关着；这时点音乐按钮会取消静音
  const musicVolume = useSettings((s) => s.musicVolume);
  const muted = useSettings((s) => s.muted);
  const music = muted ? 0 : musicVolume;
  const setS = useSettings((s) => s.set);
  const nextCam = () => {
    const next = CAMERA_ORDER[(CAMERA_ORDER.indexOf(cameraMode) + 1) % CAMERA_ORDER.length];
    set({ cameraMode: next });
    sound.play('button');
    useGame.getState().toast(`📷 ${CAMERA_LABEL[next]}`);
  };
  return (
    <div className="gbar-right">
      <button type="button" className="gbar-btn" title={`切换视角（当前：${CAMERA_LABEL[cameraMode]}）`} aria-label="切换视角" onClick={nextCam}>
        <span aria-hidden>{cameraMode === 'overview' ? '🎥' : cameraMode === 'player' ? '👀' : '🕹️'}</span>
      </button>
      <button
        type="button"
        className="gbar-btn hide-xs"
        title={music > 0 ? '关闭音乐' : '打开音乐'}
        aria-label={music > 0 ? '关闭音乐' : '打开音乐'}
        aria-pressed={music > 0}
        onClick={() => setS(music > 0 ? { musicVolume: 0 } : { muted: false, musicVolume: musicVolume || 0.35 })}
      >
        <span aria-hidden>{music > 0 ? '🎵' : '🔇'}</span>
      </button>
      <button type="button" className="gbar-btn hide-xs" title="游戏规则" aria-label="游戏规则" onClick={onRules}>
        <span aria-hidden>📖</span>
      </button>
      {/* 手机 / 平板且浏览器支持时：进入 / 退出全屏（电脑版不显示） */}
      <FullscreenButton />
      <button type="button" className="gbar-btn" title="设置" aria-label="设置" onClick={onSettings}>
        <span aria-hidden>⚙️</span>
      </button>
    </div>
  );
}

export function GameTopBar({ view, onRules, onSettings }: { view: TableView; onRules: () => void; onSettings: () => void }) {
  const set = useGame((s) => s.set);
  const room = useGame((s) => s.room);
  const mode = useGame((s) => s.mode);
  const online = mode === 'online' && room && !room.solo;
  // 电脑版顶栏额外显示当前需要跟到的下注额（移动端顶栏空间不够，保持原样）
  const pc = useIsPC();
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
          <span className="gbar-game">无限注德州扑克</span>
          <span className="gbar-item">
            <small>局</small>
            <b>#{Math.max(1, view.handNumber)}</b>
          </span>
          <span className="gbar-item">
            <small>盲注</small>
            <b>
              {view.smallBlind}/{view.bigBlind}
            </b>
          </span>
          {pc && ['preflop', 'flop', 'turn', 'river'].includes(view.phase) && (
            <span className="gbar-item">
              <small>当前注</small>
              <b>{formatChips(view.currentBet)}</b>
            </span>
          )}
          {online && (
            <span className="gbar-item gbar-room">
              <small>房间</small>
              <b>{room!.code}</b>
            </span>
          )}
        </div>
        <PhaseSteps view={view} />
      </div>
      <TableTools onRules={onRules} onSettings={onSettings} />
    </header>
  );
}
