// 画面上“已经落桌翻开”的牌：界面的点数与牌张跟着 3D 动画出现，不提前剧透。只影响显示，规则与结果不受影响。
import { useEffect, useRef, useState } from 'react';
import type { BjCard } from '../../core/blackjack/shoe';
import type { BlackjackView } from '../../core/blackjack/types';
import { DUR } from '../../animation/motion';
import { dealDelay } from '../../three/blackjack/layout';

/** 一张牌从出现到翻开的时间 */
export const LAND_MS = DUR.cardFlight + 80 + DUR.cardFlip * 0.6;

/**
 * 返回已经翻开的牌。cards 里的 null（暗牌）不算。
 * instant：第一次挂载时就全部算作已翻开（重新连接 / 刷新，不是正在发牌）
 */
export function usePresentedCards(view: BlackjackView, owner: string, cards: readonly (BjCard | null)[]): Set<string> {
  const [shown, setShown] = useState<Set<string>>(() => new Set(view.phase === 'dealing' ? [] : cards.filter((c) => c !== null).map((c) => c.uid)));
  const known = useRef(new Set(shown));
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const key = cards.map((c) => c?.uid ?? '-').join(',');
  // 只在牌张变化时处理；其余数据取最新一次渲染的
  const latest = useRef({ view, owner, cards });
  latest.current = { view, owner, cards };
  useEffect(() => {
    const { view, owner, cards } = latest.current;
    const uids = cards.map((c) => c?.uid ?? null);
    // 换了一局 / 分牌移走的牌：不再显示
    const gone = [...known.current].filter((u) => !uids.includes(u));
    if (gone.length) {
      for (const u of gone) known.current.delete(u);
      setShown((s) => new Set([...s].filter((u) => uids.includes(u))));
    }
    uids.forEach((u, i) => {
      if (!u || known.current.has(u)) return;
      known.current.add(u);
      // 暗牌翻开：牌已经在桌上，只需要翻面的时间
      const flipOnly = owner === 'dealer' && i === 1;
      const t = setTimeout(
        () => {
          timers.current.delete(t);
          setShown((s) => (known.current.has(u) ? new Set(s).add(u) : s));
        },
        flipOnly ? DUR.cardFlip : dealDelay(view, owner, i) + LAND_MS,
      );
      timers.current.add(t);
    });
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
