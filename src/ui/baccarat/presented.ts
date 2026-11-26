// 画面上“已经落桌翻开”的牌：界面的点数跟着 3D 翻牌出现，不提前剧透。只影响显示，规则与结果不受影响。
import { useEffect, useRef, useState } from 'react';
import type { BacCard } from '../../core/baccarat/shoe';
import { DUR } from '../../animation/motion';

/** 一张牌从出现到翻开的时间 */
export const BAC_LAND_MS = DUR.cardFlight + 120 + DUR.cardFlip * 0.6;

/** 返回已经翻开的牌（第一次挂载时不在开牌阶段：全部算作已翻开，例如刷新 / 重连） */
export function useLandedCards(cards: readonly BacCard[], live: boolean): Set<string> {
  const [shown, setShown] = useState<Set<string>>(() => new Set(live ? [] : cards.map((c) => c.uid)));
  const known = useRef(new Set(shown));
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const key = cards.map((c) => c.uid).join(',');
  const latest = useRef(cards);
  latest.current = cards;
  useEffect(() => {
    const uids = latest.current.map((c) => c.uid);
    const gone = [...known.current].filter((u) => !uids.includes(u));
    if (gone.length) {
      for (const u of gone) known.current.delete(u);
      setShown((s) => new Set([...s].filter((u) => uids.includes(u))));
    }
    for (const u of uids) {
      if (known.current.has(u)) continue;
      known.current.add(u);
      const t = setTimeout(() => {
        timers.current.delete(t);
        setShown((s) => (known.current.has(u) ? new Set(s).add(u) : s));
      }, BAC_LAND_MS);
      timers.current.add(t);
    }
  }, [key]);
  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current.clear();
    },
    [],
  );
  return shown;
}
