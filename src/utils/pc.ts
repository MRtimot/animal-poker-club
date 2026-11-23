// “电脑版”的统一判断：宽屏 + 鼠标（可以悬停、指针精确）。
// 手机和平板（包括横屏的大平板）都不满足，所以只在这个条件下出现的界面与行为不会影响移动端。
// CSS 中对应的写法：@media (min-width: 1101px) and (hover: hover) and (pointer: fine)
import { useEffect, useState } from 'react';

export const PC_QUERY = '(min-width: 1101px) and (hover: hover) and (pointer: fine)';

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PC_QUERY) : null;
}

export function isPC(): boolean {
  return query()?.matches ?? false;
}

/** 当前是否为电脑版（窗口大小变化时更新） */
export function useIsPC(): boolean {
  const [pc, setPc] = useState(isPC);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = () => setPc(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return pc;
}
