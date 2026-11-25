// 手机 / 平板加载页：竖版构图，单独设计（不是缩小的电脑版）
// 与电脑版共用同一套流程（useLoaderFlow：真实启动进度、卡住检测、重试、先进入、揭幕），只是画面不同。
// 结构与样式和 index.html 里的手机启动画面相同（样式内联在 index.html），React 启动后无缝接管。
import type { CSSProperties } from 'react';
import { useLoaderFlow } from './useLoaderFlow';

/** 标题入场动画结束的时间（与 index.html 中 .apm-title 的延迟 + 时长一致），从页面打开算起 */
const TITLE_IN_END_MS = 300 + 1100;

export function MobileLoader({ onReady }: { onReady: () => void }) {
  const f = useLoaderFlow(onReady, TITLE_IN_END_MS);
  if (f.gone) return null;
  const { label, shown, started, stalled, finishing } = f;

  return (
    <div
      ref={f.rootRef}
      className={`apm${f.exiting ? ' exiting' : ''}`}
      style={{ '--apl-t': f.offset } as CSSProperties}
      aria-busy={f.loading}
      onTransitionEnd={f.onRootTransitionEnd}
    >
      <div className="apm-layer apm-room" aria-hidden />
      <div className="apm-layer apm-lamp" aria-hidden />
      <div className="apm-layer apm-vignette" aria-hidden />
      <div className="apm-center">
        <div className="apm-emblem" aria-hidden>
          ♠
        </div>
        <div className="apm-eyebrow" aria-hidden>
          ANIMAL POKER CLUB
        </div>
        <h1 className="apm-title" onAnimationEnd={f.onTitleAnimationEnd}>
          动物扑克俱乐部
        </h1>
        <div className="apm-tagline">每一张牌，都有自己的故事。</div>
        <div className={`apm-meter${stalled ? ' wide' : ''}`}>
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
            <div className="apm-error" role="alert">
              <strong>牌桌暂时没能准备好</strong>
              <p>
                3D 画面长时间没有响应。
                <br />
                可以重试，或先进入俱乐部。
              </p>
              <div className="apm-actions">
                <button type="button" className="apm-btn" onClick={f.retry}>
                  重试
                </button>
                <button type="button" className="apm-btn ghost" onClick={f.skip}>
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
      <div className="apm-credits" aria-hidden>
        <span>
          <b>创始人</b>Timothy Ong · Founder of APEX
        </span>
        <span>
          <b>游戏测试员</b>熊
        </span>
      </div>
    </div>
  );
}
