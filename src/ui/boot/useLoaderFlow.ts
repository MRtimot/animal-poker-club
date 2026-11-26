// 加载页的共同流程（电脑版 PremiumLoader 与手机版 MobileLoader 共用；两者只是画面不同）
// 读取真实的启动进度（boot.ts）→ 就绪后进度线走到 100%、标题完整出现 → 退场并开始首页开场 → 移除。
// 卡住检测、重试、“先进入俱乐部”都在这里，各个画面不重复实现。
import { useEffect, useRef, useState, type AnimationEvent, type TransitionEvent } from 'react';
import { STALL_MS, bootLabel, bootProgress, bootReady, markBootStalled, retryBoot, useBoot } from '../../boot/boot';
import { homeTimeline } from '../home/homeTimeline';
import { markLoaderGone } from '../../privacy/gameNotice';

type Phase = 'loading' | 'finishing' | 'exiting' | 'gone';

/** 揭幕：首页开场（镜头推进、动物依次入座、标题与按钮出现）从这一刻开始 */
export function releaseHomeIntro() {
  if (homeTimeline.held) {
    homeTimeline.held = false;
    homeTimeline.bornAt = performance.now();
  }
  document.documentElement.classList.remove('apc-booting');
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * @param onReady 就绪（或玩家选择先进入）时调用一次
 * @param titleInEndMs 标题入场动画结束的时间（从页面打开算起，与样式中的延迟 + 时长一致）：就绪后等标题完整出现再退场
 */
export function useLoaderFlow(onReady: () => void, titleInEndMs: number) {
  const boot = useBoot();
  const ready = bootReady(boot);
  const progress = bootProgress(boot);
  const started = boot.done.core || boot.degraded;
  const [phase, setPhase] = useState<Phase>('loading');
  const [skipped, setSkipped] = useState(false);
  const [reduced] = useState(reducedMotion);
  // 接着 index.html 里的入场动画继续播放（负的延迟 = 已经过去的时间）
  const [offset] = useState(() => `${-Math.round(performance.now())}ms`);
  const rootRef = useRef<HTMLDivElement>(null);
  // 就绪后先让进度线走到 100%、标题完整出现，再退场（都由动画事件驱动，不额外等待加载）
  const [fillDone, setFillDone] = useState(false);
  const [titleDone, setTitleDone] = useState(() => reducedMotion() || performance.now() >= titleInEndMs);
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

  // 加载页完全退场后才允许出现“游戏说明”（说明从不参与、也不阻塞加载）
  useEffect(() => {
    if (phase === 'gone') markLoaderGone();
  }, [phase]);

  // 卸载时（例如出错页面接管）也要让首页开场正常开始
  useEffect(
    () => () => {
      releaseHomeIntro();
      markLoaderGone();
    },
    [],
  );

  // 就绪的同一帧就走向 100%（并使用更短的过渡），不先慢慢走再加速
  const finishing = phase !== 'loading' || ready || skipped;
  const shown = finishing ? 100 : progress;
  return {
    gone: phase === 'gone',
    loading: phase === 'loading',
    exiting: phase === 'exiting',
    finishing,
    started,
    shown,
    label: skipped ? '正在进入俱乐部' : bootLabel(boot),
    stalled: boot.stalled && phase === 'loading',
    offset,
    rootRef,
    retry: retryBoot,
    skip: () => setSkipped(true),
    onRootTransitionEnd: (e: TransitionEvent) => {
      if (phase === 'exiting' && e.target === rootRef.current && e.propertyName === 'opacity') setPhase('gone');
    },
    onFillTransitionEnd: (e: TransitionEvent) => {
      if (phase === 'finishing' && e.propertyName === 'transform') setFillDone(true);
    },
    onTitleAnimationEnd: (_e?: AnimationEvent) => setTitleDone(true),
  };
}
