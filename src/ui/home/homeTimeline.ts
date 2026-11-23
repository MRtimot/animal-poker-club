// 首页统一滚动时间轴（Scroll Timeline）
//
// 首页是一个可以用滚动控制的“宣传片”：每个段落（Section）有自己的进度 0 → 1，
// 页面文字（DOM）与 3D 场景都读取同一份时间轴，所以镜头、卡牌、筹码、动物与文字永远同步。
//
// 性能：只在滚动 / 尺寸变化时计算一次（requestAnimationFrame 合并），不触发 React 重新渲染；
// 文字动画通过 CSS 变量驱动，3D 场景在自己的渲染循环里读取这里的数值并平滑插值。

export const HOME_SECTIONS = ['hero', 'table', 'animals', 'game', 'online', 'ai', 'cta'] as const;
export type HomeSectionId = (typeof HOME_SECTIONS)[number];

/** 每个段落的滚动长度（单位：屏幕高度）。手机上整体缩短，滚动更省力 */
export const SECTION_SCREENS: Record<HomeSectionId, number> = {
  hero: 1.7,
  table: 3,
  animals: 5.4,
  game: 3.8,
  online: 3.2,
  ai: 3.2,
  cta: 2,
};

/** “认识你的对手”里依次登场的动物（真实存在的物种） */
export const FEATURED_SPECIES = ['wolf', 'fox', 'cat', 'rabbit', 'panda'] as const;

export interface HomeTimeline {
  /** 各段落进度 0 → 1 */
  progress: Record<HomeSectionId, number>;
  /** 故事位置：所有段落进度之和（0 → 7），3D 镜头沿这条轴移动 */
  story: number;
  /** 鼠标位置（-1 ~ 1），用于轻微视差 */
  pointer: { x: number; y: number };
  /** 用户开启了“减少动态效果” */
  reduced: boolean;
  /** 手机 / 窄屏：降低 3D 复杂度与镜头移动 */
  compact: boolean;
  /** 首页是否正在显示（离开首页后 3D 场景停止读取） */
  mounted: boolean;
  /** 首页出现的时间（performance.now），用于开场动画 */
  bornAt: number;
  /** 电脑版加载页还在显示：开场（镜头推进、动物入座）先停在起点，揭幕时才开始（手机上始终为 false） */
  held: boolean;
}

export const homeTimeline: HomeTimeline = {
  progress: { hero: 0, table: 0, animals: 0, game: 0, online: 0, ai: 0, cta: 0 },
  story: 0,
  pointer: { x: 0, y: 0 },
  reduced: false,
  compact: false,
  mounted: false,
  bornAt: 0,
  held: false,
};

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 平滑的 0 → 1（三次 smoothstep） */
export const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
/** 在 [a, b] 区间内从 0 平滑过渡到 1 */
export const range = (p: number, a: number, b: number) => smooth((p - a) / (b - a));

interface Reveal {
  el: HTMLElement;
  /** 开始出现（段落进度） */
  inAt: number;
  /** 开始消失；没有则一直保留到段落结束 */
  outAt: number | null;
  span: number;
}

interface SectionRef {
  id: HomeSectionId;
  el: HTMLElement;
  top: number;
  height: number;
  reveals: Reveal[];
  counters: HTMLElement[];
  last: number;
}

/**
 * 把首页的滚动容器绑定到时间轴。返回清理函数（移除所有监听，不残留）。
 * - data-reveal="0.2,0.8"：元素在段落进度 0.2 出现、0.8 消失（写入 CSS 变量 --v 与 --o）
 * - data-count="game"：元素文字由 onCount 回调根据进度更新（例如底池金额）
 */
export function bindHomeTimeline(scroller: HTMLElement, opts: { onUpdate?: (t: HomeTimeline) => void; onCount?: (el: HTMLElement, p: number) => void } = {}) {
  let sections: SectionRef[] = [];
  let frame = 0;
  let vh = window.innerHeight;

  const measure = () => {
    vh = scroller.clientHeight || window.innerHeight;
    homeTimeline.compact = window.innerWidth < 760;
    sections = HOME_SECTIONS.map((id) => {
      const el = scroller.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (!el) return null;
      const reveals = [...el.querySelectorAll<HTMLElement>('[data-reveal]')].map((r) => {
        const [a, b, s] = (r.dataset.reveal ?? '0').split(',').map(Number);
        return { el: r, inAt: a || 0, outAt: Number.isFinite(b) ? b : null, span: Number.isFinite(s) && s > 0 ? s : 0.06 };
      });
      return { id, el, top: el.offsetTop, height: el.offsetHeight, reveals, counters: [...el.querySelectorAll<HTMLElement>('[data-count]')], last: -1 };
    }).filter((x): x is SectionRef => !!x);
  };

  const update = () => {
    frame = 0;
    const y = scroller.scrollTop;
    let story = 0;
    for (const s of sections) {
      const travel = Math.max(1, s.height - vh);
      const p = clamp01((y - s.top) / travel);
      homeTimeline.progress[s.id] = p;
      story += p;
      // 只更新离屏幕不远的段落（看不到的段落不做任何 DOM 写入）
      const near = y + vh * 1.5 > s.top && y < s.top + s.height + vh * 0.5;
      if (!near || Math.abs(p - s.last) < 0.0004) continue;
      s.last = p;
      s.el.style.setProperty('--p', p.toFixed(4));
      for (const r of s.reveals) {
        const v = r.inAt <= 0 ? 1 : range(p, r.inAt, r.inAt + r.span);
        const o = r.outAt === null ? 0 : range(p, r.outAt, r.outAt + r.span);
        r.el.style.setProperty('--v', v.toFixed(3));
        r.el.style.setProperty('--o', o.toFixed(3));
        // 完全看不见的元素不接收点击（避免透明按钮挡住其他按钮）
        r.el.classList.toggle('rv-off', v * (1 - o) < 0.05);
      }
      for (const c of s.counters) opts.onCount?.(c, p);
    }
    homeTimeline.story = story;
    opts.onUpdate?.(homeTimeline);
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const onResize = () => {
    measure();
    for (const s of sections) s.last = -1;
    schedule();
  };
  const onPointer = (e: PointerEvent) => {
    homeTimeline.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    homeTimeline.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotion = () => {
    homeTimeline.reduced = !!motion?.matches;
  };

  onMotion();
  measure();
  update();
  homeTimeline.mounted = true;
  homeTimeline.bornAt = performance.now();
  scroller.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  motion?.addEventListener?.('change', onMotion);
  // 字体 / 图片加载后高度可能变化
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  ro?.observe(scroller.firstElementChild ?? scroller);

  return {
    /** 平滑滚动到某个段落 */
    scrollTo(id: HomeSectionId | 'top', at = 0) {
      const s = sections.find((x) => x.id === id);
      const top = id === 'top' || !s ? 0 : s.top + Math.max(0, s.height - vh) * at;
      scroller.scrollTo({ top, behavior: homeTimeline.reduced ? 'auto' : 'smooth' });
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      motion?.removeEventListener?.('change', onMotion);
      ro?.disconnect();
      homeTimeline.mounted = false;
      // 下次回到首页时从头开始（不残留上一次的滚动位置）
      for (const id of HOME_SECTIONS) homeTimeline.progress[id] = 0;
      homeTimeline.story = 0;
    },
  };
}
