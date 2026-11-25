// 21 点界面用到的纯函数：下注草稿、牌桌布局、结果演出的归纳（不渲染画面）
import { describe, expect, it } from 'vitest';
import { buildCine, outcomeOf, CINE_TIMING, OUTCOME_TITLE, type BjOutcome } from '../src/animation/blackjack/cineStore';
import { DEFAULT_GAME_MODE, gameModeOf, isGameMode } from '../src/core/gameMode';
import { BJ_TIMING } from '../src/core/blackjack/controller';
import { DEFAULT_RULES, TABLE_TIERS, betError, type HandResult } from '../src/core/blackjack/rules';
import { DEALER_ID, type BjHandView, type BlackjackView } from '../src/core/blackjack/types';
import { dealIndex, dealerCardTarget, handBetPos, handCardTarget, layoutSeats, seatAngles } from '../src/three/blackjack/layout';
import { addChip, betStep, nudgeBet, rebetAmount, tableChips } from '../src/ui/blackjack/bet';

const hand = (bet: number, payout: number, result: HandResult, value = 18): BjHandView =>
  ({ id: 'h' + Math.random(), cards: [], bet, payout, result, value, soft: false, bust: result === 'bust', blackjack: result === 'blackjack', done: true, doubled: false, fromSplit: false }) as unknown as BjHandView;
const viewOf = (hands: BjHandView[]) =>
  ({ viewerId: 'me', roundId: 'r1', dealer: { value: 19 }, players: [{ id: 'me', hands }] }) as unknown as BlackjackView;

describe('21 点：下注草稿', () => {
  const r = { ...DEFAULT_RULES, minBet: 10, maxBet: 200 };
  it('BJU-01 每一档牌桌的筹码面额都有意义：不超过最高下注，至少能凑出最低下注', () => {
    for (const t of TABLE_TIERS) {
      const chips = tableChips(t);
      expect(chips.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...chips)).toBeLessThanOrEqual(t.maxBet);
      expect(chips.some((c) => t.minBet % c === 0 || c >= t.minBet)).toBe(true);
    }
  });
  it('BJU-02 加筹码不会超过余额与最高下注，也不会变负', () => {
    expect(addChip(0, 25, 1000, r)).toBe(25);
    expect(addChip(190, 25, 1000, r)).toBe(200);
    expect(addChip(40, 100, 60, r)).toBe(60);
    expect(addChip(0, 25, 0, r)).toBe(0);
  });
  it('BJU-03 加减一步：从 0 直接到最低下注；减到低于最低就清空', () => {
    expect(betStep(r)).toBe(5);
    expect(nudgeBet(0, 1, 1000, r)).toBe(10);
    expect(nudgeBet(10, 1, 1000, r)).toBe(15);
    expect(nudgeBet(10, -1, 1000, r)).toBe(0);
    expect(nudgeBet(200, 1, 1000, r)).toBe(200);
  });
  it('BJU-04 重复上一局：永远是合法下注，否则为 0', () => {
    expect(rebetAmount(100, 1000, r)).toBe(100);
    expect(rebetAmount(100, 60, r)).toBe(60);
    expect(rebetAmount(100, 5, r)).toBe(0);
    expect(rebetAmount(0, 1000, r)).toBe(0);
    for (let last = 0; last <= 400; last += 7) for (let bal = 0; bal <= 300; bal += 11) {
      const v = rebetAmount(last, bal, r);
      expect(v === 0 || betError(v, bal, r) === null).toBe(true);
    }
  });
});

describe('21 点：牌桌布局', () => {
  it('BJU-05 1~8 名玩家：自己永远在镜头前，没有人坐到庄家的位置，座位互不重叠', () => {
    for (let n = 1; n <= 8; n++)
      for (let v = 0; v < n; v++) {
        const a = seatAngles(n, v);
        expect(a[v]).toBe(0);
        for (const x of a) expect(Math.abs(x)).toBeLessThanOrEqual(1.76);
        const sorted = [...a].sort((x, y) => x - y);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0.3);
      }
  });
  it('BJU-06 庄家在正对面；所有位置都是有限数字', () => {
    const m = layoutSeats(['a', 'b', 'c'], 'b');
    expect(m.get('b')!.isViewer).toBe(true);
    expect(m.get(DEALER_ID)!.angle).toBeCloseTo(Math.PI);
    for (const l of m.values()) expect([...l.seat, ...l.bet, ...l.stack].every(Number.isFinite)).toBe(true);
  });
  it('BJU-07 拆成 2~4 手：每一手的牌和下注圈都分开', () => {
    const me = layoutSeats(['a', 'b'], 'a').get('a')!;
    for (let hands = 2; hands <= 4; hands++) {
      const xs = Array.from({ length: hands }, (_, h) => handCardTarget(me, h, hands, 0, 2, false).pos[0]);
      const bs = Array.from({ length: hands }, (_, h) => handBetPos(me, h, hands)[0]);
      for (let i = 1; i < hands; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThan(0.5);
        expect(bs[i] - bs[i - 1]).toBeGreaterThan(0.3);
      }
    }
  });
  it('BJU-08 庄家从 2 张到 8 张：始终居中，后面的牌压在前面的牌上', () => {
    for (let n = 2; n <= 8; n++) {
      const t = Array.from({ length: n }, (_, i) => dealerCardTarget(i, n));
      expect(t.reduce((s, x) => s + x.pos[0], 0)).toBeCloseTo(0);
      for (let i = 1; i < n; i++) expect(t[i].pos[1]).toBeGreaterThan(t[i - 1].pos[1]);
    }
  });
  it('BJU-09 发牌顺序：庄家明牌 → 每位下注的玩家 → 庄家暗牌 → 每位下注的玩家（没下注的不占位置）', () => {
    const view = { players: [{ id: 'a', hands: [1] }, { id: 'x', hands: [] }, { id: 'b', hands: [1] }] } as unknown as BlackjackView;
    expect([dealIndex(view, DEALER_ID, 0), dealIndex(view, 'a', 0), dealIndex(view, 'b', 0), dealIndex(view, DEALER_ID, 1), dealIndex(view, 'a', 1), dealIndex(view, 'b', 1)]).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('21 点：结果演出', () => {
  it('BJU-10 单手结果直接对应', () => {
    const t: [HandResult, number, number, BjOutcome][] = [
      ['blackjack', 100, 250, 'blackjack'],
      ['win', 100, 200, 'win'],
      ['push', 100, 100, 'push'],
      ['lose', 100, 0, 'lose'],
      ['bust', 100, 0, 'bust'],
      ['dealer-blackjack', 100, 0, 'dealer-blackjack'],
    ];
    for (const [r, b, p, o] of t) expect(outcomeOf({ hands: [hand(b, p, r)] })).toEqual({ outcome: o, profit: p - b, bet: b });
  });
  it('BJU-11 拆牌后看净输赢：一赢一输 = 平局；都爆 = 爆牌；赢多 = 赢', () => {
    expect(outcomeOf({ hands: [hand(50, 100, 'win'), hand(50, 0, 'lose')] })).toMatchObject({ outcome: 'push', profit: 0 });
    expect(outcomeOf({ hands: [hand(50, 0, 'bust'), hand(50, 0, 'bust')] })).toMatchObject({ outcome: 'bust', profit: -100 });
    expect(outcomeOf({ hands: [hand(50, 100, 'win'), hand(50, 50, 'push')] })).toMatchObject({ outcome: 'win', profit: 50 });
    expect(outcomeOf({ hands: [hand(50, 0, 'bust'), hand(50, 0, 'lose')] })).toMatchObject({ outcome: 'lose', profit: -100 });
  });
  it('BJU-12 还没结算 / 旁观：没有演出', () => {
    expect(outcomeOf({ hands: [] })).toBeNull();
    expect(outcomeOf({ hands: [{ ...hand(50, 0, 'lose'), result: null } as BjHandView] })).toBeNull();
    expect(buildCine(viewOf([]))).toBeNull();
    expect(buildCine(viewOf([hand(50, 100, 'win', 20)]))).toMatchObject({ roundId: 'r1', outcome: 'win', profit: 50, value: 20, dealerValue: 19, phase: 'hush' });
  });
  it('BJU-13 每种结果都有文字（不只靠颜色），演出总长短于自动开下一局的时间', () => {
    for (const k of Object.keys(CINE_TIMING) as BjOutcome[]) {
      expect(OUTCOME_TITLE[k].en.length).toBeGreaterThan(2);
      expect(OUTCOME_TITLE[k].zh.length).toBeGreaterThan(0);
      const t = CINE_TIMING[k];
      expect(t.hush + t.verdict + t.payout).toBeLessThan(BJ_TIMING.autoNext - 1000);
    }
  });
});

describe('游戏模式', () => {
  it('BJU-14 未知 / 缺失的模式回到德州扑克（旧房间、旧存档照常）', () => {
    expect(DEFAULT_GAME_MODE).toBe('texas-holdem');
    for (const x of [undefined, null, '', 'poker', 21, {}]) expect(isGameMode(x)).toBe(false);
    expect(gameModeOf({})).toBe('texas-holdem');
    expect(gameModeOf({ gameMode: 'blackjack-21' })).toBe('blackjack-21');
  });
});
