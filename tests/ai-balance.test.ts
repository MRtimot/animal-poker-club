// AI 难度平衡测试：模拟一个“正常水平”的玩家与本地 AI 对战，统计玩家获胜率
import { describe, it, expect } from 'vitest';
import { PokerEngine } from '../src/core/table/engine';
import { decideAction, AIDifficulty, AIPersonality } from '../src/core/ai/ai';
import { estimateEquity } from '../src/core/ai/equity';
import { seededRandom, RNG } from '../src/core/utils/random';
import type { PlayerAction } from '../src/core/table/types';

const MIX: AIPersonality[] = ['aggressiveFox', 'cautiousPanda', 'smartCat', 'crazyFrog', 'luckyRabbit'];

/** 模拟一个普通玩家：牌好就加注，赔率合适就跟注，否则过牌/弃牌 */
function playerDecision(e: PokerEngine, id: string, rng: RNG): PlayerAction {
  const p = e.getPlayer(id)!;
  const l = e.getLegalActions(id)!;
  const opp = e.players.filter((x) => x.inHand && !x.folded && x.id !== id).length;
  const eq = estimateEquity(p.hole, e.board, Math.max(1, opp), 120, rng);
  const fair = 1 / (opp + 1);
  const potOdds = l.toCall > 0 ? l.toCall / (e.totalPot + l.toCall) : 0;
  if (eq > fair * 1.6 && l.canRaise) {
    const to = Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, e.currentBet + Math.round((e.totalPot + l.toCall) * 0.6)));
    return { type: 'raise', amount: to };
  }
  if (l.canCheck) return { type: 'check' };
  if (eq >= potOdds + 0.03) return { type: 'call' };
  return { type: 'fold' };
}

/** 一整场比赛（1 名玩家 vs N 个 AI），返回玩家是否夺冠、最终筹码 */
function playGame(seed: number, difficulty: AIDifficulty, aiCount: number) {
  const rng = seededRandom(seed);
  const e = new PokerEngine({ smallBlind: 10, bigBlind: 20, rng: seededRandom(seed * 7 + 3) });
  e.addPlayer('me', '玩家', 1000, 0);
  for (let i = 0; i < aiCount; i++) e.addPlayer('ai' + i, 'AI' + i, 1000, i + 1);
  for (let h = 0; h < 120 && e.canStartHand() && e.getPlayer('me')!.chips > 0; h++) {
    e.startHand();
    let guard = 0;
    while (e.isHandActive() && guard++ < 400) {
      if (e.pendingAdvance) {
        e.advance();
        continue;
      }
      const cur = e.currentPlayer!;
      const legal = e.getLegalActions(cur.id)!;
      let act: PlayerAction;
      if (cur.id === 'me') act = playerDecision(e, cur.id, rng);
      else {
        const idx = Number(cur.id.slice(2));
        act = decideAction(
          {
            hole: cur.hole, board: e.board, phase: e.phase, pot: e.totalPot, legal, chips: cur.chips, myBet: cur.bet,
            currentBet: e.currentBet, bigBlind: 20, opponents: e.players.filter((p) => p.inHand && !p.folded && p.id !== cur.id).length,
            facingRaise: e.events.some((ev) => ev.type === 'action' && (ev.action === 'raise' || ev.action === 'allin')), rng,
          },
          MIX[(idx + seed) % MIX.length],
          difficulty,
        ).action;
      }
      try {
        e.act(cur.id, act);
      } catch {
        e.act(cur.id, { type: legal.canCheck ? 'check' : 'fold' });
      }
    }
  }
  const me = e.getPlayer('me')!;
  const best = Math.max(...e.players.map((p) => p.chips));
  return { won: me.chips > 0 && me.chips === best, chips: me.chips };
}

export function winRate(difficulty: AIDifficulty, aiCount: number, games: number) {
  let wins = 0;
  let chips = 0;
  for (let s = 1; s <= games; s++) {
    const r = playGame(s * 101 + aiCount, difficulty, aiCount);
    if (r.won) wins++;
    chips += r.chips;
  }
  return { rate: wins / games, avgChips: Math.round(chips / games) };
}

describe('AI 难度平衡', () => {
  it('普通玩家对战 AI：难度越低越容易赢，简单 / 普通难度下玩家明显占优', () => {
    const res: Record<string, { rate: number; avgChips: number }> = {};
    for (const d of ['easy', 'normal', 'hard', 'expert'] as AIDifficulty[]) res[d] = winRate(d, 3, 80);
    console.log('1 名玩家 vs 3 个 AI（80 场）玩家夺冠率：', JSON.stringify(res));
    // 4 人桌公平夺冠率是 25%
    expect(res.easy.rate).toBeGreaterThanOrEqual(0.6);
    expect(res.normal.rate).toBeGreaterThanOrEqual(0.4);
    expect(res.easy.rate).toBeGreaterThan(res.normal.rate);
    expect(res.normal.rate).toBeGreaterThan(res.hard.rate);
  }, 300000);
});
