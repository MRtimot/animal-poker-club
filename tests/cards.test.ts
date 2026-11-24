// 牌面升级回归测试：手机公共牌条与 3D 牌桌共用同一份发牌节奏；平分底池时牌局记录的每一行都有唯一的 key
import { describe, it, expect } from 'vitest';
import { BOARD_DEAL, DUR, STAGGER, boardRevealMs } from '../src/animation/motion';
import { feedEntries } from '../src/ui/game/hud/model';
import type { TableView } from '../src/core/game/view';
import type { GameEvent } from '../src/core/table/types';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';

describe('CARD-01 公共牌节奏（3D 牌桌与手机公共牌条共用）', () => {
  it('与原来 3D 牌桌上写死的数值完全一致（牌桌表现不变）', () => {
    expect([0, 1, 2, 3, 4].map(BOARD_DEAL.delay)).toEqual([STAGGER.flop[0], STAGGER.flop[1], STAGGER.flop[2], 120, 120]);
    expect([0, 1, 2, 3, 4].map(BOARD_DEAL.flight)).toEqual([560, 560, 560, 560, 720]);
    expect([0, 1, 2, 3, 4].map(BOARD_DEAL.arc)).toEqual([0.18, 0.18, 0.18, 0.18, 0.32]);
    expect([0, 1, 2, 3, 4].map(BOARD_DEAL.revealPause)).toEqual([90, 90, 90, 220, 520]);
  });

  it('公共牌条在牌桌上的牌翻完、正面朝上时才显示：翻牌三张依次出现，河牌停顿最久', () => {
    const t = [0, 1, 2, 3, 4].map(boardRevealMs);
    expect(t[0]).toBe(0 + 560 + 90 + DUR.cardFlip);
    expect(t[0]).toBeLessThan(t[1]);
    expect(t[1]).toBeLessThan(t[2]);
    expect(t[4]).toBeGreaterThan(t[3]);
    // 不会让玩家等太久
    expect(Math.max(...t)).toBeLessThan(2200);
  });
});

describe('CARD-02 平分底池：牌局记录每位赢家一行，key 不重复', () => {
  it('同一个派奖事件里有 2 位赢家：两行文字都在，key 各不相同', () => {
    const player = (id: string, name: string) => ({ id, name, profile: { name, animal: DEFAULT_ANIMAL, level: 1 } });
    const events: GameEvent[] = [
      { type: 'showdown', hands: [], seq: 10, t: 0 },
      { type: 'win', awards: [{ playerId: 'a', amount: 50, potIndex: 0 }, { playerId: 'b', amount: 50, potIndex: 0 }], uncontested: false, pots: [100], seq: 11, t: 0 },
    ] as unknown as GameEvent[];
    const view = { viewerId: 'a', handNumber: 3, players: [player('a', '甲'), player('b', '乙')], events, summary: null } as unknown as TableView;
    const out = feedEntries(view, { hand: -1, seq: 0 }, 10);
    const wins = out.filter((e) => e.tone === 'win');
    expect(wins).toHaveLength(2);
    expect(new Set(out.map((e) => e.key)).size).toBe(out.length);
  });
});
