// 电脑版首页右侧的“创建房间”入口（Premium Floating CTA）
// 只在电脑版渲染（手机 / 平板上不存在这个元素）。点击直接创建真实的在线房间：
// 客户端只发送“创建房间”，房间代码与房主由服务器决定，房间信息到达后现有流程会自动进入房间大厅。
// 入口会根据真实状态变化：正在创建 / 失败重试 / 返回房间 / 返回牌桌 / 重新连接，不会重复创建房间。
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useGame } from '../../store/gameStore';
import { net } from '../../net/netClient';
import { quickCreateRoom, roomCtaState, useQuickRoom, type RoomCtaState } from '../../net/quickRoom';
import { sound } from '../../audio/sound';
import { useIsPC } from '../../utils/pc';
import { homeTimeline, type HomeTimeline } from './homeTimeline';

/** 滚到结尾段落（那里有自己的“创建房间”按钮与页脚）时入口让开 */
export const ctaAway = (t: HomeTimeline) => t.progress.cta > 0.2;

/** 第一次进入首页时等标题与按钮出现后再出现；之后回到首页时很快出现 */
let introduced = false;

function useCtaState(): RoomCtaState {
  const room = useGame((s) => s.room);
  const mode = useGame((s) => s.mode);
  const hasView = useGame((s) => s.view !== null || s.bj !== null);
  const lastRoom = useGame((s) => s.lastRoom);
  const conn = useGame((s) => s.conn);
  const request = useQuickRoom();
  return roomCtaState({ room, mode, hasView, lastRoom, conn, request });
}

/** 连接超过几秒还没成功：免费服务器可能正在唤醒 */
function useSlow(active: boolean, ms = 4000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!active) return;
    const t = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(t);
  }, [active, ms]);
  return slow;
}

interface View {
  eyebrow: string;
  title: string;
  sub: string;
  note?: string;
  busy?: boolean;
  label: string;
  tip: string;
  tone?: 'error' | 'return';
}

function describe(st: RoomCtaState, slow: boolean): View {
  switch (st.kind) {
    case 'create':
      return { eyebrow: 'PRIVATE TABLE', title: '创建房间', sub: '开一桌 · 邀请朋友', label: '创建房间：开一个在线牌桌，把房间代码发给朋友', tip: '创建一个新的在线牌局' };
    case 'creating': {
      const sub = st.conn === 'connected' ? '正在生成房间代码' : slow ? '服务器正在唤醒，通常不到 1 分钟' : '正在连接游戏服务器';
      return { eyebrow: 'PRIVATE TABLE', title: '正在创建房间…', sub, busy: true, label: `正在创建房间，${sub}`, tip: sub };
    }
    case 'error':
      return { eyebrow: 'PRIVATE TABLE', title: '创建失败', sub: '点击重试', note: st.message, tone: 'error', label: `创建房间失败：${st.message}。点击重试`, tip: st.message };
    case 'lobby':
      return { eyebrow: 'YOUR TABLE', title: '返回房间', sub: st.code, tone: 'return', label: `返回房间 ${st.code}`, tip: '回到房间大厅' };
    case 'game':
      return { eyebrow: 'YOUR TABLE', title: '返回牌桌', sub: st.code ? `房间 ${st.code} · 牌局进行中` : '牌局进行中', tone: 'return', label: '返回牌桌', tip: '回到正在进行的牌局' };
    case 'reconnect': {
      const busy = st.conn === 'connecting';
      return {
        eyebrow: 'YOUR TABLE',
        title: busy ? '正在重新连接…' : '重新连接',
        sub: `房间 ${st.code}`,
        busy,
        tone: 'return',
        label: busy ? `正在重新连接房间 ${st.code}` : `重新连接房间 ${st.code}`,
        tip: '回到刷新前所在的房间',
      };
    }
  }
}

/**
 * 与首屏右下角的账号卡片对齐：同一条右边线（首页内容区有滚动条，宽度因浏览器而异）、同样的宽度，停在卡片上方。
 * 只在尺寸变化时测量（ResizeObserver），不在滚动或每一帧里计算。
 */
function useAlignWithHero(ref: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const el = ref.current;
    const scroller = document.querySelector<HTMLElement>('.home-scroll');
    const chip = document.querySelector<HTMLElement>('.hero-account');
    if (!el || !scroller) return;
    const sync = () => {
      el.style.setProperty('--rcta-sbw', `${Math.max(0, scroller.offsetWidth - scroller.clientWidth)}px`);
      if (chip) {
        el.style.setProperty('--rcta-clear', `${chip.offsetHeight}px`);
        el.style.setProperty('--rcta-chip-w', `${chip.offsetWidth}px`);
      }
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(scroller);
    if (chip) ro.observe(chip);
    return () => ro.disconnect();
  }, [ref]);
}

export function DesktopRoomCTA() {
  const pc = useIsPC();
  if (!pc) return null;
  return <RoomCTAInner />;
}

function RoomCTAInner() {
  const st = useCtaState();
  const slow = useSlow(st.kind === 'creating' && st.conn !== 'connected');
  const v = describe(st, slow);
  const [late] = useState(() => !introduced);
  useEffect(() => {
    introduced = true;
  }, []);
  const wrap = useRef<HTMLDivElement>(null);
  useAlignWithHero(wrap);
  // 例如窗口从平板宽度拉大成电脑版时，入口在页面中途出现：按当前滚动位置决定是否让开
  useEffect(() => {
    wrap.current?.classList.toggle('away', ctaAway(homeTimeline));
  }, []);

  const onClick = () => {
    if (v.busy) return; // 正在创建 / 正在连接：不重复发送
    sound.play('button');
    const g = useGame.getState();
    switch (st.kind) {
      case 'create':
      case 'error':
        void quickCreateRoom();
        break;
      case 'lobby':
        g.setScreen('room');
        break;
      case 'game':
        g.setScreen('game');
        break;
      case 'reconnect':
        net.connect();
        break;
    }
  };

  return (
    <div ref={wrap} className={`rcta-wrap${late ? ' rcta-late' : ''}`} data-room-cta>
      <button
        type="button"
        className={`rcta${v.busy ? ' busy' : ''}${v.tone ? ' ' + v.tone : ''}`}
        onClick={onClick}
        aria-label={v.label}
        aria-disabled={v.busy || undefined}
        aria-busy={v.busy || undefined}
        title={v.tip}
      >
        <span className="rcta-top" aria-hidden>
          <span className="rcta-suit">{v.busy ? <i className="rcta-spin" /> : st.kind === 'error' ? '!' : '♠'}</span>
          <span className="rcta-eyebrow">{v.eyebrow}</span>
          <span className="rcta-spark">✦</span>
        </span>
        <span className="rcta-title" aria-hidden>
          {v.title}
        </span>
        <span className={`rcta-sub${st.kind === 'lobby' ? ' code' : ''}`} aria-hidden>
          {v.sub}
          {!v.busy && <span className="rcta-arrow">→</span>}
        </span>
        {v.note && (
          <span className="rcta-note" aria-hidden>
            {v.note}
          </span>
        )}
      </button>
      {/* 状态变化（正在创建 / 失败）告诉读屏软件 */}
      <span className="rcta-live" role="status" aria-live="polite">
        {st.kind === 'creating' ? '正在创建房间' : st.kind === 'error' ? `创建房间失败：${st.message}` : ''}
      </span>
    </div>
  );
}
