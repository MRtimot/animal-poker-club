// 系统“减少动态效果”设置：镜头少动、不震动、不环绕，粒子与过渡更少
let reduced = false;

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced = mq.matches;
  mq.addEventListener?.('change', (e) => {
    reduced = e.matches;
  });
}

export function prefersReducedMotion(): boolean {
  return reduced;
}
