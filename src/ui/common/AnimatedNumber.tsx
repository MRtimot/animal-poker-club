import { useEffect, useRef, useState } from 'react';
import { DUR, ease } from '../../animation/motion';
import { formatChips } from '../../utils/format';

/** 数字平滑变化：1000 → 1100 → … → 1500，而不是瞬间跳变 */
export function useTweenNumber(value: number, ms: number = DUR.number) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const cur = useRef(value);
  useEffect(() => {
    if (value === cur.current) return;
    from.current = cur.current;
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / ms);
      const v = Math.round(from.current + (value - from.current) * ease.outCubic(p));
      cur.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** 带“增加时轻微放大”效果的筹码数字 */
export function AnimatedChips({ value, ms, className = '' }: { value: number; ms?: number; className?: string }) {
  const shown = useTweenNumber(value, ms);
  const [bump, setBump] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (value > prev.current) setBump((b) => b + 1);
    prev.current = value;
  }, [value]);
  return (
    <span key={bump} className={`anum ${bump ? 'num-bump' : ''} ${className}`}>
      {formatChips(shown)}
    </span>
  );
}
