// 电脑版加载页：进入俱乐部的第一幕（只在电脑版使用；手机与平板仍是原来的 LoadingScreen）
// 结构与样式和 index.html 里的启动画面完全相同（样式内联在 index.html），React 启动后无缝接管：
// 入场动画按页面打开以来的时间继续播放，不会重新开始。
// 进度只在真实的启动步骤完成时增加（见 boot.ts）；就绪后进度线走到 100%，标志淡出，背景褪去，露出 3D 俱乐部。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { STALL_MS, bootLabel, bootProgress, bootReady, markBootStalled, retryBoot, useBoot } from '../../boot/boot';
import { homeTimeline } from '../home/homeTimeline';

type Phase = 'loading' | 'finishing' | 'exiting' | 'gone';

/** 标题入场动画结束的时间（与 index.html 中 .apl-title 的延迟 + 时长一致），从页面打开算起 */
const TITLE_IN_END_MS = 220 + 1300;

/** 揭幕：首页开场（镜头推进、动物依次入座、标题与按钮出现）从这一刻开始 */
export function releaseHomeIntro() {
  if (homeTimeline.held) {
    homeTimeline.held = false;
    homeTimeline.bornAt = performance.now();
  }
  document.documentElement.classList.remove('apc-booting');
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function PremiumLoader({ onReady }: { onReady: () => void }) {
  const boot = useBoot();
  const ready = bootReady(boot);
  const progress = bootProgress(boot);
  const started = boot.done.core || boot.degraded;
  const [phase, setPhase] = useState<Phase>('loading');
  const [skipped, setSkipped] = useState(false);
  const [reduced] = useState(reducedMotion);
  // 接着 index.html 里的入场动画继续播放（负的延迟 = 已经过去的时间）
  const [offset] = useState(() => `${-Math.round(performance.now())}ms`);
  const root = useRef<HTMLDivElement>(null);
  // 就绪后先让进度线走到 100%、标题完整出现，再退场（都由动画事件驱动，不额外等待加载）
  const [fillDone, setFillDone] = useState(false);
  const [titleDone, setTitleDone] = useState(() => reducedMotion() || performance.now() >= TITLE_IN_END_MS);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // 卡住检测：页面在前台、超过一段时间没有任何步骤完成 → 显示原因与重试（后台标签页不计时）
  useEffect(() => {
    if (phase !== 'loading') return;
    let hiddenAt = 0;
    const iv = window.setInterval(() => {
      const b = useBoot.getState();
      if (document.visibilityState !== 'visible') {
        hiddenAt = performance.now();
        return;
      }
      const since = performance.now() - Math.max(b.lastProgressAt, hiddenAt);
      if (!b.stalled && !bootReady(b) && since > STALL_MS) markBootStalled();
    }, 1000);
    return () => window.clearInterval(iv);
  }, [phase]);

  // 就绪（或玩家选择先进入）：进度线走到 100%，然后退场
  useEffect(() => {
    if (phase !== 'loading' || !(ready || skipped)) return;
    onReadyRef.current();
    setPhase('finishing');
  }, [ready, skipped, phase]);

  const exit = () => {
    releaseHomeIntro();
    // 减少动态效果时也走退场（只有很短的淡出），保证从加载页到首页不是生硬的跳切
    setPhase((p) => (p === 'loading' || p === 'finishing' ? 'exiting' : p));
  };

  useEffect(() => {
    if (phase === 'finishing' && (reduced || skipped || (fillDone && titleDone))) exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fillDone, titleDone]);

  useEffect(() => {
    if (phase === 'finishing') {
      // 兜底：动画事件没有触发（例如浏览器节流）时也会退场
      const t = window.setTimeout(exit, 2000);
      return () => window.clearTimeout(t);
    }
    if (phase === 'exiting') {
      const t = window.setTimeout(() => setPhase('gone'), 1600);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 卸载时（例如出错页面接管）也要让首页开场正常开始
  useEffect(() => () => releaseHomeIntro(), []);

  if (phase === 'gone') return null;

  const label = skipped ? '正在进入俱乐部' : bootLabel(boot);
  // 就绪的同一帧就走向 100%（并使用更短的过渡），不先慢慢走再加速
  const finishing = phase !== 'loading' || ready || skipped;
  const shown = finishing ? 100 : progress;
  const stalled = boot.stalled && phase === 'loading';

  return (
    <div
      ref={root}
      className={`apl${phase === 'exiting' ? ' exiting' : ''}`}
      style={{ '--apl-t': offset } as CSSProperties}
      aria-busy={phase === 'loading'}
      onTransitionEnd={(e) => {
        if (phase === 'exiting' && e.target === root.current && e.propertyName === 'opacity') setPhase('gone');
      }}
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
        <h1 className="apl-title" onAnimationEnd={() => setTitleDone(true)}>
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
              onTransitionEnd={(e) => {
                if (phase === 'finishing' && e.propertyName === 'transform') setFillDone(true);
              }}
            />
            {phase === 'loading' && !stalled && <i className="apl-scan" />}
          </div>
          <div className={`apl-pct${started ? '' : ' none'}`} style={{ '--apl-p': shown } as CSSProperties} aria-hidden />
          {stalled ? (
            <div className="apl-error" role="alert">
              <p>牌桌暂时没能准备好：3D 画面长时间没有响应（可能是显卡繁忙或驱动问题）。可以重新准备，或者先进入俱乐部（3D 画面稍后出现）。</p>
              <div className="apl-actions">
                <button type="button" className="apl-btn" onClick={retryBoot} autoFocus>
                  重试
                </button>
                <button type="button" className="apl-btn ghost" onClick={() => setSkipped(true)}>
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
        <b>游戏测试员</b> John
      </div>
    </div>
  );
}
