// 游戏说明：第一次进入首页 / 模式选择时出现一次（深色玻璃面板 + 柔和金边），点“继续”后不再出现。
// 只是“这是一款虚拟娱乐游戏”的说明，不是用户协议或法律同意：没有勾选框、没有“同意”字样。
// 另外提供各个模式 / 在线房间页面使用的轻量标识（VirtualTag / OnlineVirtualNote）。
import { useEffect, useRef } from 'react';
import { acknowledgeGameNotice, shouldShowGameNotice, useGameNotice } from '../../privacy/gameNotice';
import { useGame } from '../../store/gameStore';
import './notice.css';

/** 说明正在显示（Cookie 说明条等其他底部提示先让开） */
export function useGameNoticeOpen(): boolean {
  const acknowledged = useGameNotice((s) => s.acknowledged);
  const loaderGone = useGameNotice((s) => s.loaderGone);
  const screen = useGame((s) => s.screen);
  return shouldShowGameNotice({ acknowledged, loaderGone }, screen);
}

export function GameNoticeLayer() {
  const open = useGameNoticeOpen();
  return open ? <GameNoticeDialog /> : null;
}

/**
 * 刚出现的一小段时间里不接受“继续”：上一页用 Enter 提交（例如输入昵称后按回车）时，
 * 同一次按键的后续事件会落到刚获得焦点的“继续”上，说明还没被看到就关掉了。
 */
export const NOTICE_ARM_MS = 600;

function GameNoticeDialog() {
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(performance.now());
  const onContinue = () => {
    if (performance.now() - openedAt.current < NOTICE_ARM_MS) return;
    acknowledgeGameNotice();
  };

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    btn.current?.focus({ preventScroll: true });
    // 焦点留在说明里（只有一个按钮：Tab / Shift+Tab 都回到“继续”）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        btn.current?.focus({ preventScroll: true });
      }
    };
    const el = box.current;
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      if (prev && prev.isConnected && prev !== document.body) prev.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="gnx-backdrop">
      <div ref={box} className="gnx" role="dialog" aria-modal="true" aria-labelledby="gnx-title" aria-describedby="gnx-desc">
        <div className="gnx-scroll">
          <div className="gnx-eyebrow" aria-hidden>
            <i />
            <span>♠</span> ANIMAL POKER CLUB
            <i />
          </div>
          <h2 id="gnx-title" className="gnx-title">
            <span className="gnx-title-en">GAME NOTICE</span>
            <span className="gnx-title-zh">游戏说明</span>
          </h2>

          <div id="gnx-desc">
            <p className="gnx-lead">
              动物扑克俱乐部是一款<b>虚拟娱乐游戏</b>。
              <span className="gnx-en">Animal Poker Club is a virtual entertainment game.</span>
            </p>

            <div className="gnx-modes" aria-label="游戏模式：德州扑克、21 点、百家乐">
              <span>德州扑克 Texas Hold&rsquo;em</span>
              <i aria-hidden>•</i>
              <span>21 点 Blackjack 21</span>
              <i aria-hidden>•</i>
              <span>百家乐 Baccarat</span>
            </div>

            <p className="gnx-body">
              以上均为虚拟游戏玩法，只使用游戏内的虚拟金币与筹码。
              <span className="gnx-en">Presented as virtual game modes using virtual in-game Coins and Chips only.</span>
            </p>

            <ul className="gnx-list">
              <li>
                不提供真钱下注<span className="gnx-en">No real-money betting</span>
              </li>
              <li>
                不提供提现<span className="gnx-en">No cash-out</span>
              </li>
              <li>
                不提供现实货币奖励<span className="gnx-en">No real-world monetary rewards</span>
              </li>
            </ul>

            <p className="gnx-foot">仅供娱乐 · For entertainment purposes only</p>
          </div>
        </div>
        <div className="gnx-actions">
          <button ref={btn} type="button" className="gnx-btn" onClick={onContinue}>
            继续 <span aria-hidden>·</span> <span className="gnx-btn-en">CONTINUE</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** 各模式页面的轻量标识：VIRTUAL GAME · 虚拟金币 · 不涉及真钱赌博 */
export function VirtualTag({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return (
    <div className={`vtag${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`} role="note" aria-label="虚拟游戏：只使用虚拟金币，不涉及真钱赌博">
      <span className="vtag-en" aria-hidden>
        VIRTUAL GAME
      </span>
      <span className="vtag-sep" aria-hidden />
      <span aria-hidden>仅限虚拟金币 · 不涉及真钱赌博</span>
    </div>
  );
}

/** 在线房间：多人游戏同样只是虚拟游戏 */
export function OnlineVirtualNote() {
  return (
    <div className="vnote" role="note">
      <div className="vnote-head">
        <span className="vtag-en">VIRTUAL MULTIPLAYER GAME</span>
        <b>虚拟多人游戏</b>
      </div>
      <p>
        房间里的所有金币与筹码都是虚拟的，没有任何现实货币价值；不提供真钱下注或提现。
        <span className="gnx-en">All Coins and Chips are virtual and have no real-world monetary value. No real-money betting or cash-out.</span>
      </p>
    </div>
  );
}
