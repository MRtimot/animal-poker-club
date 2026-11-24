// 跟随 3D 座位的界面层：玩家名牌、下注金额、底池。
// 位置来自牌桌布局（与 3D 动物、筹码同一套座位坐标），内容只读取引擎状态与事件导演的演出进度。
import { memo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { hudInsets } from '../camera/CameraRig';
import type { SeatView, TableView } from '../../core/game/view';
import { BOARD_SCALE, CARD_H, POT_POS, boardPos, type SeatLayout, type V3 } from '../layout';
import { AnimatedChips } from '../../ui/common/AnimatedNumber';
import { useFx } from '../../store/fxStore';
import { useGame } from '../../store/gameStore';
import { formatChips } from '../../utils/format';
import { PosBadges, SeatAvatar, TimerBar } from '../../ui/game/hud/bits';
import { turnClock, useServerNow } from '../../ui/game/hud/clock';
import { presentedPot, seatStatus } from '../../ui/game/hud/model';
import { useIsPC } from '../../utils/pc';

const tmpP = new THREE.Vector3();
/**
 * 名牌的屏幕位置：跟随 3D 座位，但始终留在屏幕内（窄屏上两侧的座位不会被切掉），
 * 也不钻到顶栏和底部操作区下面。
 */
function clampedPosition(el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }) {
  const p = tmpP.setFromMatrixPosition(el.matrixWorld).project(camera);
  const x = (p.x * size.width) / 2 + size.width / 2;
  const y = (-p.y * size.height) / 2 + size.height / 2;
  const mx = size.width <= 760 ? 46 : 96;
  const { top, bottom } = hudInsets(size.width, size.height);
  return [Math.min(size.width - mx, Math.max(mx, x)), Math.min(size.height - bottom - 24, Math.max(top + 36, y))];
}

/** 头顶的情绪表情：弹出 → 漂浮 → 淡出 */
function MoodBadge({ playerId }: { playerId: string }) {
  const m = useFx((s) => s.moods[playerId]);
  if (!m) return null;
  return (
    <div key={m.start} className="mood-pop" style={{ animationDuration: `${Math.max(800, m.until - m.start)}ms` }}>
      {m.emoji}
    </div>
  );
}

/** 聊天 / 表情 / 角色台词气泡 */
function Bubble({ playerId }: { playerId: string }) {
  const b = useFx((s) => s.bubbles.find((x) => x.playerId === playerId));
  // 正在播放真实语音时显示 🔊
  const voiced = useFx((s) => !!s.speech[playerId]?.voiced && s.speech[playerId]?.phase === 'speaking');
  if (!b) return null;
  if (b.kind === 'dialogue') {
    return (
      <div key={b.id} className="bubble bubble-dialogue">
        <div className="bd-head">
          <span>{b.speaker}</span>
          {voiced && (
            <span className="bd-voice" aria-label="正在说话">
              🔊
            </span>
          )}
        </div>
        <div className="bd-text">“{b.text}”</div>
      </div>
    );
  }
  return (
    <div key={b.id} className={`bubble ${b.kind === 'emote' ? 'bubble-emote' : ''}`}>
      {b.text}
    </div>
  );
}

function SeatTimer({ view }: { view: TableView }) {
  const now = useServerNow(true);
  const clock = turnClock(view, now);
  if (!clock || !view.turnDeadline) return null;
  return <TimerBar clock={clock} deadline={view.turnDeadline} />;
}

/**
 * 其他玩家的名牌：头像、名字、筹码、位置（庄 / 小盲 / 大盲）、当前状态、行动倒计时、摊牌牌型、赢得的筹码。
 * 自己的信息在屏幕下方的座位面板里，这里只保留气泡与表情的锚点。
 */
export const SeatPlate = memo(function SeatPlate({ p, view, layout, winAmount, revealHand, revealDelay }: {
  p: SeatView;
  view: TableView;
  layout: SeatLayout;
  /** 赢得的筹码：赢家演出开始后才显示（不提前剧透） */
  winAmount: number;
  /** 摊牌已经开始演出：显示牌型（与亮牌顺序同步淡入） */
  revealHand: boolean;
  revealDelay: number;
}) {
  // 在线房间里已经不在成员列表中：玩家离开了（而不是暂时断线）
  const left = useGame((s) => !!s.room && !s.room.solo && !s.room.members.some((m) => m.id === p.id));
  if (layout.isViewer) {
    return (
      <Html position={[layout.head[0], layout.head[1] + 0.2, layout.head[2]]} center zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
        <div className="splate-anchor">
          <Bubble playerId={p.id} />
          <MoodBadge playerId={p.id} />
          {winAmount > 0 && <div className="sp-win">+{formatChips(winAmount)}</div>}
        </div>
      </Html>
    );
  }
  const st = seatStatus(p, view, left);
  const isCurrent = view.currentPlayerId === p.id;
  const offline = !p.connected && !p.isAI && !left;
  const cls = [isCurrent && 'current', p.folded && 'folded', p.allIn && !p.folded && 'allin', offline && 'offline', (p.busted || p.sittingOut || left) && 'out', winAmount > 0 && 'winner']
    .filter(Boolean)
    .join(' ');
  return (
    <Html position={layout.tag} center zIndexRange={[20, 0]} calculatePosition={clampedPosition} style={{ pointerEvents: 'none' }}>
      <div className={`splate ${cls}`}>
        <Bubble playerId={p.id} />
        <MoodBadge playerId={p.id} />
        <div className="sp-main">
          <SeatAvatar p={p} size="sm" />
          <div className="sp-body">
            <div className="sp-name">
              <span className="sp-name-text">{p.name}</span>
              {p.isAI && <i className="sp-tag">AI</i>}
              {!p.isAI && p.profile.level ? <i className="sp-lv">Lv.{p.profile.level}</i> : null}
            </div>
            <div className="sp-chips">
              <span className="chip-ico" aria-hidden />
              <AnimatedChips value={p.chips} />
            </div>
          </div>
          <PosBadges view={view} id={p.id} />
        </div>
        {revealHand && p.shown && !p.folded ? (
          <div className="sp-hand" style={{ animationDelay: `${revealDelay}ms` }}>
            {p.shown.handName}
          </div>
        ) : (
          st.text && <div className={`sp-status ${st.cls}`}>{st.text}</div>
        )}
        {isCurrent && <SeatTimer view={view} />}
        {winAmount > 0 && <div className="sp-win">+{formatChips(winAmount)}</div>}
      </div>
    </Html>
  );
});

/** 玩家面前的下注金额（筹码落地后才显示） */
export function BetTag({ amount, position }: { amount: number; position: V3 }) {
  if (amount <= 0) return null;
  return (
    <Html position={[position[0], position[1] + 0.32, position[2]]} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
      <div className="bet-tag">
        <span className="chip-ico" aria-hidden />
        {formatChips(amount)}
      </div>
    </Html>
  );
}

/** 底池：公共牌上方，随筹码飞入后平滑增加；有全押时列出主池 / 边池 */
/**
 * 手机 / 平板：底池牌的下边缘固定在公共牌上边缘之上一点（牌桌远、牌小，而底池牌是固定大小的界面元素，
 * 以前放在中间会正好盖住公共牌的点数）。电脑版保持原来的位置。
 */
const POT_MOBILE_Z = boardPos(0)[2] - (CARD_H * BOARD_SCALE) / 2 - 0.06;

export function PotPlaque({ view }: { view: TableView }) {
  const shown = useFx((s) => s.shown);
  const pc = useIsPC();
  const pot = presentedPot(view, shown);
  if (pot <= 0) return null;
  const side = view.pots.length > 1 && pot === view.potTotal;
  return (
    <Html position={pc ? [POT_POS[0], POT_POS[1] + 0.06, POT_POS[2] + 0.42] : [POT_POS[0], POT_POS[1] + 0.06, POT_MOBILE_Z]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`pot-plaque${pc ? '' : ' above-board'}`} role="status" aria-label={`底池 ${formatChips(pot)}`}>
        <span className="pot-cap">底池</span>
        <span className="pot-num">
          <span className="chip-ico" aria-hidden />
          <AnimatedChips value={pot} />
        </span>
        {side && (
          <span className="pot-side">
            {view.pots.map((amt, i) => (
              <span key={i}>
                {i === 0 ? '主池' : `边池 ${i}`} {formatChips(amt)}
              </span>
            ))}
          </span>
        )}
      </div>
    </Html>
  );
}

/**
 * 电脑版：还没发牌时（空桌）在公共牌位置显示牌局状态，空桌与正在进行的牌局一眼就能区分。
 * 移动端保持原样。
 */
export function TableStatus({ view }: { view: TableView }) {
  const pc = useIsPC();
  if (!pc || view.gameOver || view.handNumber > 0) return null;
  const seated = view.players.filter((p) => !p.busted && !p.sittingOut).length;
  return (
    <Html position={[POT_POS[0], POT_POS[1] + 0.06, POT_POS[2] + 1.05]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="table-status" role="status">
        <span className="ts-title">牌局即将开始</span>
        <span className="ts-sub">
          {seated} 位玩家已入座 · 盲注 {view.smallBlind}/{view.bigBlind} · 正在洗牌
        </span>
      </div>
    </Html>
  );
}
