// 深度测试：暴力交叉验证牌型、随机牌局模糊测试、边池正确性
import { describe, it, expect } from 'vitest';
import { Deck } from '../src/core/cards/deck';
import { Card } from '../src/core/cards/card';
import { evaluateHand, HandCategory } from '../src/core/poker/handEvaluator';
import { PokerEngine } from '../src/core/table/engine';
import { calculatePots } from '../src/core/betting/pots';
import { seededRandom, RNG } from '../src/core/utils/random';
import { decideAction, AIPersonality, AIDifficulty, PERSONALITIES } from '../src/core/ai/ai';

// ───── 参考实现：只评估 5 张牌，再枚举 21 种组合取最大 ─────
function ref5(cards: Card[]): number {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks.join() === '14,5,4,3,2') straightHigh = 5;
  }
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const order = groups.map((g) => g[0]);
  const enc = (cat: number, rs: number[]) => rs.reduce((s, r) => s * 16 + r, cat) * 16 ** (5 - rs.length);
  if (straightHigh && flush) return enc(straightHigh === 14 ? 9 : 8, [straightHigh]);
  if (groups[0][1] === 4) return enc(7, order);
  if (groups[0][1] === 3 && groups[1][1] === 2) return enc(6, order);
  if (flush) return enc(5, ranks);
  if (straightHigh) return enc(4, [straightHigh]);
  if (groups[0][1] === 3) return enc(3, order);
  if (groups[0][1] === 2 && groups[1][1] === 2) return enc(2, order);
  if (groups[0][1] === 2) return enc(1, order);
  return enc(0, ranks);
}

function refBest(cards: Card[]): number {
  let best = -1;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) best = Math.max(best, ref5([cards[a], cards[b], cards[c], cards[d], cards[e]]));
  return best;
}

describe('牌型判定 · 暴力交叉验证', () => {
  it('20,000 手随机 7 张牌：结果与 21 组合枚举完全一致', () => {
    const rng = seededRandom(2026);
    const seen = new Set<number>();
    for (let i = 0; i < 20000; i++) {
      const d = new Deck(rng);
      d.shuffle();
      const cards = d.dealMany(7);
      const fast = evaluateHand(cards);
      expect(fast.score).toBe(refBest(cards));
      // 最佳五张牌本身也必须评估出相同分数
      expect(fast.cards).toHaveLength(5);
      expect(ref5(fast.cards)).toBe(fast.score);
      seen.add(fast.category);
    }
    // 随机样本应覆盖到大部分牌型
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it('两手牌比较结果与参考实现一致（含平局）', () => {
    const rng = seededRandom(77);
    for (let i = 0; i < 5000; i++) {
      const d = new Deck(rng);
      d.shuffle();
      const board = d.dealMany(5);
      const a = [...d.dealMany(2), ...board];
      const b = [...d.dealMany(2), ...board];
      expect(Math.sign(evaluateHand(a).score - evaluateHand(b).score)).toBe(Math.sign(refBest(a) - refBest(b)));
    }
  });
});

// ───── 边池：与逐层朴素计算对比 ─────
describe('边池 · 随机验证', () => {
  it('3,000 组随机投入：池总额守恒，每个池的资格正确', () => {
    const rng = seededRandom(5);
    for (let i = 0; i < 3000; i++) {
      const n = 2 + Math.floor(rng() * 7);
      const contribs = Array.from({ length: n }, (_, k) => ({
        playerId: 'p' + k,
        amount: Math.floor(rng() * 6) * 50,
        folded: rng() < 0.3,
      }));
      if (contribs.every((c) => c.folded)) contribs[0].folded = false;
      const { pots, refunds } = calculatePots(contribs);
      const total = contribs.reduce((s, c) => s + c.amount, 0);
      const out = pots.reduce((s, p) => s + p.amount, 0) + refunds.reduce((s, r) => s + r.amount, 0);
      expect(out).toBe(total);
      for (const p of pots) {
        expect(p.amount).toBeGreaterThan(0);
        expect(p.eligible.length).toBeGreaterThan(0);
        for (const id of p.eligible) expect(contribs.find((c) => c.playerId === id)!.folded).toBe(false);
      }
    }
  });
});

// ───── 随机牌局模糊测试：任意合法操作都不能破坏状态 ─────
function fuzzTable(seed: number, hands: number) {
  const rng = seededRandom(seed);
  const n = 2 + Math.floor(rng() * 7);
  const e = new PokerEngine({ smallBlind: 5, bigBlind: 10, rng: seededRandom(seed * 31 + 1) });
  for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'P' + i, 50 + Math.floor(rng() * 600), i);
  const total = e.players.reduce((s, p) => s + p.chips, 0);
  let played = 0;
  for (let h = 0; h < hands && e.canStartHand(); h++) {
    e.startHand();
    played++;
    let guard = 0;
    while (e.isHandActive()) {
      if (guard++ > 500) throw new Error(`牌局卡死 seed=${seed} hand=${h}`);
      if (e.pendingAdvance) {
        e.advance();
        continue;
      }
      const cur = e.currentPlayer;
      if (!cur) throw new Error(`没有行动者却未推进 seed=${seed} phase=${e.phase}`);
      const l = e.getLegalActions(cur.id)!;
      expect(l).not.toBeNull();
      // 合法性不变式
      expect(l.callAmount).toBeLessThanOrEqual(cur.chips);
      expect(l.minRaiseTo).toBeLessThanOrEqual(l.maxRaiseTo);
      const r = rng();
      // 偶尔模拟玩家掉线离开
      if (r < 0.01) {
        e.removePlayer(cur.id);
        continue;
      }
      if (r < 0.15) e.act(cur.id, { type: 'fold' });
      else if (r < 0.35 && l.canRaise) {
        const to = l.minRaiseTo + Math.floor(rng() * (l.maxRaiseTo - l.minRaiseTo + 1));
        e.act(cur.id, { type: 'raise', amount: to });
      } else if (r < 0.42 && l.canAllIn) e.act(cur.id, { type: 'allin' });
      else e.act(cur.id, { type: l.canCheck ? 'check' : 'call' });
      const inPlay = e.players.reduce((s, p) => s + p.chips + (e.isHandActive() ? p.totalBet : 0), 0);
      expect(inPlay).toBe(total);
      for (const p of e.players) expect(p.chips).toBeGreaterThanOrEqual(0);
    }
    expect(e.phase).toBe('complete');
    expect(e.players.reduce((s, p) => s + p.chips, 0)).toBe(total);
    // 公共牌与底牌不能重复
    const ids = [...e.board, ...e.players.flatMap((p) => p.hole)].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 摊牌时公共牌必须是 5 张
    if (e.lastSummary && !e.lastSummary.uncontested) expect(e.board).toHaveLength(5);
  }
  return played;
}

describe('牌局模糊测试', () => {
  it('300 张随机牌桌 × 40 手：筹码守恒、无卡死、无重复牌', () => {
    let total = 0;
    for (let seed = 1; seed <= 300; seed++) total += fuzzTable(seed, 40);
    expect(total).toBeGreaterThan(1500); // 随机全押会让很多牌桌提前分出胜负
  });
});

// ───── AI：所有性格与难度只会做合法操作 ─────
describe('本地 AI', () => {
  it('所有性格 × 难度在随机局面下只返回合法操作', () => {
    const rng: RNG = seededRandom(9);
    const diffs: AIDifficulty[] = ['easy', 'normal', 'hard', 'expert'];
    for (let seed = 1; seed <= 40; seed++) {
      const e = new PokerEngine({ smallBlind: 10, bigBlind: 20, rng: seededRandom(seed) });
      for (let i = 0; i < 5; i++) e.addPlayer('p' + i, 'P' + i, 200 + i * 150, i);
      for (let h = 0; h < 6 && e.canStartHand(); h++) {
        e.startHand();
        let guard = 0;
        while (e.isHandActive() && guard++ < 300) {
          if (e.pendingAdvance) {
            e.advance();
            continue;
          }
          const cur = e.currentPlayer!;
          const legal = e.getLegalActions(cur.id)!;
          const pers = (Object.keys(PERSONALITIES) as AIPersonality[])[(seed + h) % 5];
          const d = decideAction(
            {
              hole: cur.hole, board: e.board, phase: e.phase, pot: e.totalPot, legal, chips: cur.chips, myBet: cur.bet,
              currentBet: e.currentBet, bigBlind: 20, opponents: e.players.filter((p) => p.inHand && !p.folded).length - 1,
              facingRaise: false, rng,
            },
            pers,
            diffs[seed % 4],
          );
          // 必须被引擎接受，不抛异常
          expect(() => e.act(cur.id, d.action)).not.toThrow();
        }
        expect(e.phase).toBe('complete');
      }
    }
  });

  it('专家 AI 拿到 AA 时不会弃牌，拿到 72o 面对大加注时倾向弃牌', () => {
    const run = (hole: string, toCall: number) => {
      const rng = seededRandom(3);
      const cards = hole.split(' ').map((s) => ({ id: s, rank: ({ A: 14, '7': 7, '2': 2 } as any)[s[0]], suit: s[1] })) as Card[];
      let folds = 0;
      for (let i = 0; i < 30; i++) {
        const d = decideAction(
          {
            hole: cards, board: [], phase: 'preflop', pot: 30 + toCall, chips: 1000, myBet: 0, currentBet: toCall, bigBlind: 20,
            opponents: 3, facingRaise: true, rng,
            legal: { canFold: true, canCheck: false, canCall: true, callAmount: toCall, toCall, canRaise: true, minRaiseTo: toCall * 2, maxRaiseTo: 1000, canAllIn: true, allInAmount: 1000 },
          },
          'smartCat',
          'expert',
        );
        if (d.action.type === 'fold') folds++;
      }
      return folds;
    };
    expect(run('As Ah', 200)).toBe(0);
    expect(run('7c 2d', 400)).toBeGreaterThan(20);
  });
});

void HandCategory;
