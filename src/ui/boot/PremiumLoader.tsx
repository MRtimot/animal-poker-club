// 电脑版加载页：进入俱乐部的第一幕（只在电脑版使用；手机与平板使用 MobileLoader，流程相同、画面不同）
// 结构与样式和 index.html 里的启动画面完全相同（样式内联在 index.html），React 启动后无缝接管：
// 入场动画按页面打开以来的时间继续播放，不会重新开始。
// 进度只在真实的启动步骤完成时增加（见 boot.ts）；就绪后进度线走到 100%，标志淡出，背景褪去，露出 3D 俱乐部。
import type { CSSProperties } from 'react';
import { useLoaderFlow } from './useLoaderFlow';

export { releaseHomeIntro } from './useLoaderFlow';

/** 标题入场动画结束的时间（与 index.html 中 .apl-title 的延迟 + 时长一致），从页面打开算起 */
const TITLE_IN_END_MS = 220 + 1300;

export function PremiumLoader({ onReady }: { onReady: () => void }) {
  const f = useLoaderFlow(onReady, TITLE_IN_END_MS);
  if (f.gone) return null;
  const { label, shown, started, stalled, finishing } = f;

  return (
    <div
      ref={f.rootRef}
      className={`apl${f.exiting ? ' exiting' : ''}`}
      style={{ '--apl-t': f.offset } as CSSProperties}
      aria-busy={f.loading}
      onTransitionEnd={f.onRootTransitionEnd}
    >
      <div className="apl-layer apl-room" aria-hidden />
      <div className="apl-layer apl-lamp" aria-hidden />
      <div className="apl-layer apl-sweep" aria-hidden />
      <div className="apl-layer apl-dust" aria-hidden />
      <div className="apl-layer apl-vignette" aria-hidden />
      <div className="apl-center">
        <div className="apl-eyebrow" aria-hidden>
          <i />
          ANIMAL POKER CLUB
          <i />
        </div>
        <h1 className="apl-title" onAnimationEnd={f.onTitleAnimationEnd}>
          动物扑克俱乐部
        </h1>
        <div className="apl-suit" aria-hidden>
          ♠
        </div>
        <div className="apl-meter">
          <div
            className="apl-track"
            role="progressbar"
            aria-label="加载进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={started ? shown : undefined}
            aria-valuetext={started ? `${shown}%，${label}` : label}
          >
            <i
              className={`apl-fill${finishing ? ' done' : ''}`}
              style={{ '--apl-f': shown / 100 } as CSSProperties}
              onTransitionEnd={f.onFillTransitionEnd}
            />
            {f.loading && !stalled && <i className="apl-scan" />}
          </div>
          <div className={`apl-pct${started ? '' : ' none'}`} style={{ '--apl-p': shown } as CSSProperties} aria-hidden />
          {stalled ? (
            <div className="apl-error" role="alert">
              <p>牌桌暂时没能准备好：3D 画面长时间没有响应（可能是显卡繁忙或驱动问题）。可以重新准备，或者先进入俱乐部（3D 画面稍后出现）。</p>
              <div className="apl-actions">
                <button type="button" className="apl-btn" onClick={f.retry} autoFocus>
                  重试
                </button>
                <button type="button" className="apl-btn ghost" onClick={f.skip}>
                  先进入俱乐部
                </button>
              </div>
            </div>
          ) : (
            <div className="apl-status" aria-live="polite">
              {label}
            </div>
          )}
        </div>
      </div>
      <div className="apl-credits" aria-hidden>
        <b>创始人</b> Timothy Ong · Founder of APEX<span>·</span>
        <b>游戏测试员</b> 熊
      </div>
    </div>
  );
}
