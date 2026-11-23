// 牌局界面的展示模型：底池 / 下注金额与动画同步、牌局记录不剧透、加注快捷金额合法
import { describe, it, expect } from 'vitest';
import { PokerEngine } from '../src/core/table/engine';
import { seededRandom } from '../src/core/utils/random';
import type { TableView } from '../src/core/game/view';
import type { LegalActions } from '../src/core/table/types';
import { eventShown, feedEntries, presentedBets, presentedPot, raisePresets, raiseStep, seatStatus, snapRaise } from '../src/ui/game/hud/model';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';

/** 用真实引擎跑到某个时刻，拼出一个最小的 TableView（只含界面模型需要的字段） */
function viewOf(e: PokerEngine, viewerId = 'p0'): TableView {
  return {
    viewerId,
    handNumber: e.handNumber,
    phase: e.phase,
    board: [...e.board],
    potCollected: e.isHandActive() ? e.collectedPot : 0,
    potTotal: e.isHandActive() ? e.totalPot : 0,
    pots: [],
    currentBet: e.currentBet,
    currentPlayerId: e.currentPlayer?.id ?? null,
    dealerId: null,
    sbId: null,
    bbId: null,
    smallBlind: e.smallBlind,
    bigBlind: e.bigBlind,
    players: e.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      chips: p.chips,
      bet: p.bet,
      totalBet: p.totalBet,
      folded: p.folded,
      allIn: p.allIn,
      inHand: p.inHand,
      sittingOut: false,
      busted: false,
      isAI: p.id !== viewerId,
      connected: true,
      profile: { name: p.name, animal: { ...DEFAULT_ANIMAL } },
      lastAction: p.lastAction,
      hole: p.hole,
    })),
    legal: null,
    turnDeadline: null,
    turnTotalMs: 0,
    events: [...e.events],
    summary: e.lastSummary,
    gameOver: null,
    nextHandAt: null,
    serverTime: 0,
    paused: false,
  } as TableView;
}

function table(n = 3) {
  const e = new PokerEngine({ smallBlind: 10, bigBlind: 20, rng: seededRandom(5) });
  for (let i = 0; i < n; i++) e.addPlayer('p' + i, '玩家' + i, 1000, i);
  e.startHand();
  return e;
}

describe('底池与下注：随动画落地才变化', () => {
  it('演出进度未知时以服务器为准；演出到盲注时只显示盲注；全部演完与引擎一致', () => {
    const e = table();
    const cur = e.currentPlayer!;
    e.act(cur.id, { type: 'raise', amount: 60 });
    const v = viewOf(e);
    const last = v.events[v.events.length - 1].seq;
    const blindSeq = v.events.filter((x) => x.type === 'blind').at(-1)!.seq;
    expect(presentedPot(v, { hand: -1, seq: 0 })).toBe(v.potTotal);
    expect(presentedPot(v, { hand: v.handNumber, seq: blindSeq })).toBe(30);
    expect(presentedPot(v, { hand: v.handNumber, seq: last })).toBe(v.potTotal);
    expect(v.potTotal).toBe(90);
    // 导演还停在上一手：这一手还没有任何筹码落地
    expect(presentedPot(v, { hand: v.handNumber - 1, seq: 999 })).toBe(0);
    // 下注金额：加注前只有盲注
    const bets = presentedBets(v, { hand: v.handNumber, seq: blindSeq });
    expect([...bets.values()].sort((a, b) => a - b)).toEqual([10, 20]);
    expect(presentedBets(v, { hand: v.handNumber, seq: last }).get(cur.id)).toBe(60);
  });

  it('派奖事件演出后底池归零；摊牌事件演出前不显示牌型', () => {
    const e = table(2);
    let guard = 0;
    while (e.isHandActive() && guard++ < 50) {
      if (e.pendingAdvance) e.advance();
      else {
        const c = e.currentPlayer!;
        const l = e.getLegalActions(c.id)!;
        e.act(c.id, { type: l.canCheck ? 'check' : 'call' });
      }
    }
    const v = viewOf(e);
    const sd = v.events.find((x) => x.type === 'showdown')!;
    const win = v.events.find((x) => x.type === 'win')!;
    expect(presentedPot(v, { hand: v.handNumber, seq: sd.seq })).toBeGreaterThan(0);
    expect(presentedPot(v, { hand: v.handNumber, seq: win.seq })).toBe(0);
    expect(eventShown(v, { hand: v.handNumber, seq: sd.seq - 1 }, 'showdown')).toBe(false);
    expect(eventShown(v, { hand: v.handNumber, seq: sd.seq }, 'showdown')).toBe(true);
    // 牌局记录：赢家只在派奖演出后出现
    const before = feedEntries(v, { hand: v.handNumber, seq: sd.seq }, 50);
    const after = feedEntries(v, { hand: v.handNumber, seq: win.seq }, 50);
    expect(before.some((x) => x.tone === 'win')).toBe(false);
    expect(after.some((x) => x.tone === 'win')).toBe(true);
  });
});

describe('牌局记录', () => {
  it('翻牌后的第一个“加注”显示为下注，之后的显示为加注到；自己显示为“你”', () => {
    const e = table(2);
    const sb = e.currentPlayer!;
    e.act(sb.id, { type: 'call' });
    e.act(e.currentPlayer!.id, { type: 'check' });
    e.advance(); // 翻牌
    const first = e.currentPlayer!;
    e.act(first.id, { type: 'raise', amount: 40 });
    e.act(e.currentPlayer!.id, { type: 'raise', amount: 120 });
    const v = viewOf(e);
    const texts = feedEntries(v, { hand: v.handNumber, seq: 9999 }, 50).map((x) => x.text);
    expect(texts.some((t) => /^翻牌 /.test(t))).toBe(true);
    expect(texts).toContain(`${first.id === 'p0' ? '你' : '玩家' + first.id.slice(1)} 下注 40`);
    expect(texts.some((t) => t.endsWith('加注到 120'))).toBe(true);
    expect(texts.some((t) => t.startsWith('你'))).toBe(true);
  });

  it('座位状态：当前行动 / 弃牌 / 全押 / 跟注金额', () => {
    const e = table(3);
    const v = viewOf(e);
    const cur = v.players.find((p) => p.id === v.currentPlayerId)!;
    expect(seatStatus(cur, v).cls).toBe('thinking');
    expect(seatStatus({ ...cur, folded: true }, { currentPlayerId: null }).text).toBe('已弃牌');
    expect(seatStatus({ ...cur, allIn: true }, { currentPlayerId: null }).cls).toBe('allin');
    expect(seatStatus({ ...cur, lastAction: { type: 'call', amount: 40 } }, { currentPlayerId: null }).text).toBe('跟注 40');
    // 暂时断线 vs 已经离开房间
    expect(seatStatus({ ...cur, isAI: false, connected: false }, { currentPlayerId: null }).text).toBe('重新连接中…');
    expect(seatStatus({ ...cur, isAI: false, connected: false, sittingOut: true }, { currentPlayerId: null }, true).text).toBe('已离开');
  });
});

describe('加注面板', () => {
  const legal = (min: number, max: number, toCall = 0): LegalActions => ({
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: toCall,
    canRaise: true,
    minRaiseTo: min,
    maxRaiseTo: max,
    canAllIn: true,
    allInAmount: max,
    toCall,
  });

  it('翻牌前无人加注：2× / 2.5× / 3× 大盲 + 全押；全部在合法范围内且不重复', () => {
    const p = raisePresets({ phase: 'preflop', currentBet: 20, bigBlind: 20, potTotal: 30 }, legal(40, 1000, 20));
    expect(p.map((x) => x.label)).toEqual(['2×', '2.5×', '3×', '全押']);
    expect(p.map((x) => x.to)).toEqual([40, 50, 60, 1000]);
  });

  it('翻牌后：底池比例；超过最大值的选项合并为全押；筹码很少时只剩全押', () => {
    const p = raisePresets({ phase: 'flop', currentBet: 0, bigBlind: 20, potTotal: 120 }, legal(20, 100));
    expect(p.at(-1)).toEqual({ label: '全押', to: 100, allIn: true });
    for (const x of p) {
      expect(x.to).toBeGreaterThanOrEqual(20);
      expect(x.to).toBeLessThanOrEqual(100);
    }
    expect(new Set(p.map((x) => x.to)).size).toBe(p.length);
    const tiny = raisePresets({ phase: 'turn', currentBet: 0, bigBlind: 20, potTotal: 400 }, legal(25, 25));
    expect(tiny).toEqual([{ label: '全押', to: 25, allIn: true }]);
  });

  it('金额规整：对齐步长，最小 / 最大（全押）总是允许，非法输入回到最小值', () => {
    const l = { minRaiseTo: 40, maxRaiseTo: 987 };
    const step = raiseStep(20);
    expect(step).toBe(10);
    expect(snapRaise(123, l, step)).toBe(120);
    expect(snapRaise(5, l, step)).toBe(40);
    expect(snapRaise(5000, l, step)).toBe(987);
    expect(snapRaise(NaN, l, step)).toBe(40);
    expect(snapRaise(985, l, step)).toBe(987);
  });
});
