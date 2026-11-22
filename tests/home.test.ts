// 首页展示内容的真实性：演示牌局按真实规则判定、没有重复的牌、动物资料来自游戏数据、时间轴工具函数
import { describe, it, expect } from 'vitest';
import { compareHands, evaluateHand, HandCategory } from '../src/core/poker/handEvaluator';
import { AI_HAND, DEMO_HAND, JOIN_AT, SEAT_SPECIES } from '../src/three/scenes/homeCast';
import { demoPot, handText, POT_FINAL } from '../src/ui/home/demoHand';
import { FEATURED_SPECIES, HOME_SECTIONS, SECTION_SCREENS, range, smooth } from '../src/ui/home/homeTimeline';
import { PERSONALITIES_BY_SPECIES, VOICE_PROFILES } from '../src/core/character/voice';
import { SPECIES_MAP } from '../src/core/player/profile';

describe('首页演示牌局', () => {
  it('“你赢了”是真的：游戏引擎判定你的两对 A、K 胜过对手的两对 Q、7', () => {
    const hero = evaluateHand([...DEMO_HAND.hero, ...DEMO_HAND.board]);
    const rival = evaluateHand([...DEMO_HAND.rival, ...DEMO_HAND.board]);
    expect(hero.category).toBe(HandCategory.TwoPair);
    expect(handText(hero)).toBe('两对（A 与 K）');
    expect(rival.category).toBe(HandCategory.TwoPair);
    expect(handText(rival)).toBe('两对（Q 与 7）');
    expect(compareHands(hero, rival)).toBeGreaterThan(0);
  });

  it('演示里没有重复的牌（同一副牌）', () => {
    const demo = [...DEMO_HAND.hero, ...DEMO_HAND.rival, ...DEMO_HAND.board].map((c) => c.id);
    expect(new Set(demo).size).toBe(demo.length);
    const ai = [...AI_HAND.hero, ...AI_HAND.board].map((c) => c.id);
    expect(new Set(ai).size).toBe(ai.length);
  });

  it('底池金额随进度单调增加，最终等于“赢得底池”的金额', () => {
    let last = 0;
    for (let p = 0; p <= 1; p += 0.01) {
      const v = demoPot(p);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(demoPot(0)).toBe(300);
    expect(demoPot(1)).toBe(POT_FINAL);
  });
});

describe('首页动物与在线展示', () => {
  it('登场的动物都是游戏里真实存在的物种，并且有性格与声音资料', () => {
    for (const sp of [...FEATURED_SPECIES, ...Object.values(SEAT_SPECIES)]) {
      expect(SPECIES_MAP[sp], sp).toBeTruthy();
      expect(PERSONALITIES_BY_SPECIES[sp].catchphrases.length, sp).toBeGreaterThan(0);
      expect(VOICE_PROFILES[sp].personality.tone, sp).toBeTruthy();
    }
  });

  it('在线段落：朋友依次加入（时间点递增、都在段落内），加入的是桌边真实就座的动物', () => {
    const times = Object.values(JOIN_AT).sort((a, b) => a - b);
    for (const t of times) expect(t > 0 && t < 0.7).toBe(true);
    for (const k of Object.keys(JOIN_AT)) expect(SEAT_SPECIES[Number(k)]).toBeTruthy();
  });
});

describe('滚动时间轴工具', () => {
  it('每个段落都有滚动长度；smooth / range 在区间外被限制在 0 ~ 1', () => {
    for (const id of HOME_SECTIONS) expect(SECTION_SCREENS[id]).toBeGreaterThan(1);
    expect(smooth(-1)).toBe(0);
    expect(smooth(2)).toBe(1);
    expect(smooth(0.5)).toBeCloseTo(0.5);
    expect(range(0.1, 0.2, 0.4)).toBe(0);
    expect(range(0.5, 0.2, 0.4)).toBe(1);
    expect(range(0.3, 0.2, 0.4)).toBeCloseTo(0.5);
  });
});
