// 首页共用的小组件：滚动段落、按时间轴出现的元素、段落眉标
import type { CSSProperties, ReactNode } from 'react';
import { SECTION_SCREENS, type HomeSectionId } from './homeTimeline';

/** 一个滚动段落：外层决定滚动长度，内层“舞台”固定在屏幕上，内容随进度变化 */
export function StorySection({ id, className = '', children, label }: { id: HomeSectionId; className?: string; children: ReactNode; label: string }) {
  return (
    <section className={`hs hs-${id} ${className}`} data-section={id} aria-label={label} style={{ '--scr': SECTION_SCREENS[id] } as CSSProperties}>
      <div className="hs-stage">{children}</div>
    </section>
  );
}

/**
 * 按段落进度出现 / 消失的元素：at = 开始出现，out = 开始消失（可选），span = 过渡长度。
 * 实际的透明度与位移由 CSS 变量 --v（出现）与 --o（消失）控制，滚动时不触发 React 渲染。
 */
export function Reveal({ at, out, span, className = '', children, as: Tag = 'div', style }: { at: number; out?: number; span?: number; className?: string; children?: ReactNode; as?: 'div' | 'p' | 'h2' | 'h3' | 'span' | 'li'; style?: CSSProperties }) {
  return (
    <Tag className={`rv ${className}`} data-reveal={[at, out ?? 'x', span ?? 'x'].join(',')} style={style}>
      {children}
    </Tag>
  );
}

/** 段落小标题（编号 + 英文眉标） */
export function Eyebrow({ n, children }: { n?: string; children: ReactNode }) {
  return (
    <div className="eyebrow">
      {n && <span className="eyebrow-n">{n}</span>}
      <span className="eyebrow-line" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
