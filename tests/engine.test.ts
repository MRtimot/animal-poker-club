import { describe, it, expect } from 'vitest';
import { PokerEngine } from '../src/core/table/engine';
import { calculatePots, splitPot } from '../src/core/betting/pots';
import { parseCards } from '../src/core/cards/card';
import { seededRandom } from '../src/core/utils/random';

function table(chips: number[], sb = 10, bb = 20, seed = 1) {
  const e = new PokerEngine({ smallBlind: sb, bigBlind: bb, rng: seededRandom(seed) });
  chips.forEach((c, i) => e.addPlayer('p' + i, '玩家' + i, c, i));
  return e;
}

/** 将指定玩家的底牌与公共牌强制设定（用于确定性测试） */
function rig(e: PokerEngine, holes: Record<string, string>, board: string) {
  for (const [id, cards] of Object.entries(holes)) e.getPlayer(id)!.hole = parseCards(cards);
  const b = parseCards(board);
  // 替换内部牌堆：advance 会 burn + deal，从末尾 pop
  const deck: any = (e as any).deck;
  const order = [b[4], 'burn', b[3], 'burn', b[2], b[1], b[0], 'burn'];
  const filler = deck.cards.filter((c: any) => !b.some((x) => x.id === c.id));
  deck.cards = [...filler.slice(0, 10), ...order.map((x: any) => (x === 'burn' ? filler[20] : x))];
}

function sum(e: PokerEngine) {
  return e.players.reduce((s, p) => s + p.chips + (e.isHandActive() ? p.totalBet : 0), 0);
}

function runToEnd(e: PokerEngine) {
  let guard = 0;
  while (e.isHandActive() && guard++ < 50) {
    if (e.pendingAdvance) e.advance();
    else {
      const cur = e.currentPlayer!;
      const l = e.getLegalActions(cur.id)!;
      e.act(cur.id, { type: l.canCheck ? 'check' : 'call' });
    }
  }
}

describe('盲注与庄家', () => {
  it('三人桌：庄家、小盲、大盲位置与下注正确', () => {
    const e = table([1000, 1000, 1000]);
    e.startHand();
    expect(e.dealerSeat).toBe(0);
    expect(e.sbSeat).toBe(1);
    expect(e.bbSeat).toBe(2);
    expect(e.getPlayer('p1')!.bet).toBe(10);
    expect(e.getPlayer('p2')!.bet).toBe(20);
    // 翻牌前第一个行动的是大盲左边（庄家）
    expect(e.currentPlayer!.id).toBe('p0');
    for (const p of e.players) expect(p.hole).toHaveLength(2);
  });

  it('单挑时庄家是小盲，翻牌前先行动，翻牌后后行动', () => {
    const e = table([1000, 1000]);
    e.startHand();
    expect(e.sbSeat).toBe(e.dealerSeat);
    expect(e.currentPlayer!.seat).toBe(e.dealerSeat);
    e.act(e.currentPlayer!.id, { type: 'call' });
    // 大盲获得选择权
    expect(e.currentPlayer!.seat).toBe(e.bbSeat);
    e.act(e.currentPlayer!.id, { type: 'check' });
    expect(e.pendingAdvance).toBe(true);
    e.advance();
    expect(e.phase).toBe('flop');
    expect(e.board).toHaveLength(3);
    expect(e.currentPlayer!.seat).toBe(e.bbSeat);
  });

  it('庄家按钮每手顺时针轮换，跳过已出局玩家', () => {
    const e = table([1000, 1000, 1000, 1000]);
    const dealers: number[] = [];
    for (let h = 0; h < 5; h++) {
      e.startHand();
      dealers.push(e.dealerSeat);
      // 所有人弃牌给大盲
      while (e.isHandActive()) e.act(e.currentPlayer!.id, { type: 'fold' });
    }
    expect(dealers).toEqual([0, 1, 2, 3, 0]);
    e.getPlayer('p1')!.chips = 0;
    e.startHand();
    expect(e.dealerSeat).toBe(2); // 上一手庄家 0 → 跳过出局的 1
    expect(e.getPlayer('p1')!.inHand).toBe(false);
  });

  it('筹码不足大盲时全押入池', () => {
    const e = table([1000, 1000, 15]);
    e.startHand();
    const bb = e.getPlayer('p2')!;
    expect(bb.bet).toBe(15);
    expect(bb.allIn).toBe(true);
    expect(e.currentBet).toBe(20);
  });
});

describe('下注', () => {
  it('过牌、跟注、加注与最小加注额', () => {
    const e = table([1000, 1000, 1000]);
    e.startHand();
    const l = e.getLegalActions('p0')!;
    expect(l.canCheck).toBe(false);
    expect(l.callAmount).toBe(20);
    expect(l.minRaiseTo).toBe(40);
    expect(() => e.act('p0', { type: 'raise', amount: 30 })).toThrow();
    e.act('p0', { type: 'raise', amount: 60 }); // 加注 40
    expect(e.currentBet).toBe(60);
    const l1 = e.getLegalActions('p1')!;
    expect(l1.minRaiseTo).toBe(100); // 60 + 40
    expect(l1.callAmount).toBe(50);
    e.act('p1', { type: 'call' });
    e.act('p2', { type: 'call' });
    expect(e.pendingAdvance).toBe(true);
    e.advance();
    expect(e.collectedPot).toBe(180);
    const fl = e.getLegalActions(e.currentPlayer!.id)!;
    expect(fl.canCheck).toBe(true);
    expect(fl.minRaiseTo).toBe(20);
  });

  it('不能乱序行动 / 不能非法过牌', () => {
    const e = table([1000, 1000, 1000]);
    e.startHand();
    expect(() => e.act('p1', { type: 'call' })).toThrow('还没轮到你');
    expect(() => e.act('p0', { type: 'check' })).toThrow();
  });

  it('所有人弃牌，最后一人直接赢下底池', () => {
    const e = table([1000, 1000, 1000]);
    e.startHand();
    e.act('p0', { type: 'fold' });
    e.act('p1', { type: 'fold' });
    expect(e.phase).toBe('complete');
    expect(e.getPlayer('p2')!.chips).toBe(1010);
    expect(e.lastSummary!.uncontested).toBe(true);
  });

  it('全押与不足额加注不重新开放加注', () => {
    const e = table([1000, 1000, 130]);
    e.startHand(); // p0 庄, p1 小盲, p2 大盲
    e.act('p0', { type: 'raise', amount: 100 }); // 加注 80
    e.act('p1', { type: 'call' });
    e.act('p2', { type: 'allin' }); // 130：仅多 30，不足额
    expect(e.currentBet).toBe(130);
    const l0 = e.getLegalActions('p0')!;
    expect(l0.canRaise).toBe(false);
    expect(l0.callAmount).toBe(30);
    e.act('p0', { type: 'call' });
    const l1 = e.getLegalActions('p1')!;
    expect(l1.canRaise).toBe(false);
    e.act('p1', { type: 'call' });
    expect(e.pendingAdvance).toBe(true);
  });

  it('筹码守恒：任意随机牌局后总筹码不变', () => {
    const rng = seededRandom(99);
    const e = table([500, 800, 1200, 300, 2000], 5, 10, 3);
    const total = sum(e);
    for (let h = 0; h < 60 && e.canStartHand(); h++) {
      e.startHand();
      let guard = 0;
      while (e.isHandActive() && guard++ < 200) {
        if (e.pendingAdvance) {
          e.advance();
          continue;
        }
        const cur = e.currentPlayer!;
        const l = e.getLegalActions(cur.id)!;
        const r = rng();
        if (r < 0.15) e.act(cur.id, { type: 'fold' });
        else if (r < 0.3 && l.canRaise) e.act(cur.id, { type: 'raise', amount: l.minRaiseTo });
        else if (r < 0.36 && l.canAllIn) e.act(cur.id, { type: 'allin' });
        else e.act(cur.id, { type: l.canCheck ? 'check' : 'call' });
        expect(sum(e)).toBe(total);
      }
      expect(e.phase).toBe('complete');
      expect(sum(e)).toBe(total);
      for (const p of e.players) expect(p.chips).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('底池与边池', () => {
  it('主池 + 边池计算', () => {
    const r = calculatePots([
      { playerId: 'a', amount: 100, folded: false },
      { playerId: 'b', amount: 300, folded: false },
      { playerId: 'c', amount: 300, folded: false },
      { playerId: 'd', amount: 50, folded: true },
    ]);
    expect(r.pots).toEqual([
      { amount: 350, eligible: ['a', 'b', 'c'] },
      { amount: 400, eligible: ['b', 'c'] },
    ]);
    expect(r.refunds).toEqual([]);
  });

  it('无人跟注的超额下注退回', () => {
    const r = calculatePots([
      { playerId: 'a', amount: 500, folded: false },
      { playerId: 'b', amount: 200, folded: false },
    ]);
    expect(r.pots).toEqual([{ amount: 400, eligible: ['a', 'b'] }]);
    expect(r.refunds).toEqual([{ playerId: 'a', amount: 300 }]);
  });

  it('平分底池，零头按顺序分配', () => {
    const m = splitPot(101, ['x', 'y']);
    expect(m.get('x')).toBe(51);
    expect(m.get('y')).toBe(50);
    const m3 = splitPot(100, ['a', 'b', 'c']);
    expect([...m3.values()]).toEqual([34, 33, 33]);
  });

  it('短码全押赢主池，边池归第二名', () => {
    const e = table([100, 1000, 1000]);
    e.startHand(); // p0 庄
    rig(e, { p0: 'As Ad', p1: 'Ks Kd', p2: '7c 2d' }, '3h 8s 9c Jd 4h');
    e.act('p0', { type: 'allin' }); // 100
    e.act('p1', { type: 'raise', amount: 400 });
    e.act('p2', { type: 'call' });
    // 翻牌后 p1、p2 过牌到底
    runToEnd(e);
    expect(e.phase).toBe('complete');
    // 主池 300 给 p0（AA），边池 600 给 p1（KK）
    expect(e.getPlayer('p0')!.chips).toBe(300);
    expect(e.getPlayer('p1')!.chips).toBe(600 + 600);
    expect(e.getPlayer('p2')!.chips).toBe(600);
    const win = e.events.find((x) => x.type === 'win') as any;
    expect(win.pots).toEqual([300, 600]);
  });

  it('平局时平分底池', () => {
    const e = table([1000, 1000]);
    e.startHand();
    rig(e, { p0: '2c 3d', p1: '2h 4d' }, '9s Ts Jd Qh Kc');
    runToEnd(e);
    expect(e.getPlayer('p0')!.chips).toBe(1000);
    expect(e.getPlayer('p1')!.chips).toBe(1000);
    expect(e.lastSummary!.winners).toHaveLength(2);
  });

  it('全员全押后自动发完公共牌并摊牌', () => {
    const e = table([300, 300, 300]);
    e.startHand();
    e.act('p0', { type: 'allin' });
    e.act('p1', { type: 'allin' });
    e.act('p2', { type: 'allin' });
    expect(e.currentPlayer).toBeNull();
    let n = 0;
    while (e.isHandActive() && n++ < 10) {
      expect(e.pendingAdvance).toBe(true);
      e.advance();
    }
    expect(e.board).toHaveLength(5);
    expect(e.phase).toBe('complete');
    expect(e.players.reduce((s, p) => s + p.chips, 0)).toBe(900);
    expect(e.events.some((x) => x.type === 'showdown')).toBe(true);
  });

  it('离开的玩家自动弃牌', () => {
    const e = table([1000, 1000, 1000]);
    e.startHand();
    e.removePlayer('p0'); // 轮到 p0 时离开
    expect(e.getPlayer('p0')!.folded).toBe(true);
    expect(e.currentPlayer!.id).toBe('p1');
    e.removePlayer('p2'); // 非轮到时离开 → 只剩 p1
    expect(e.phase).toBe('complete');
    expect(e.getPlayer('p1')!.chips).toBe(1020); // 小盲投入 10，赢回 30 的底池
  });
});
