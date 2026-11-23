// 牌局状态机：引擎的阶段只能按 PHASE_TRANSITIONS 前进；每个阶段的可用动作、事件顺序与 UI 进度条一致
import { describe, it, expect } from 'vitest';
import { PokerEngine, PokerError } from '../src/core/table/engine';
import { PHASE_ACTIONS, PHASE_TRANSITIONS, STREET_STEPS, canTransition } from '../src/core/table/stateMachine';
import type { Phase } from '../src/core/table/types';
import { seededRandom } from '../src/core/utils/random';

function randomTable(seed: number) {
  const rng = seededRandom(seed);
  const n = 2 + Math.floor(rng() * 5);
  const e = new PokerEngine({ smallBlind: 10, bigBlind: 20, rng: seededRandom(seed * 7 + 1) });
  for (let i = 0; i < n; i++) e.addPlayer('p' + i, '玩家' + i, 200 + Math.floor(rng() * 1800), i);
  return { e, rng };
}

describe('牌局状态机', () => {
  it('转换表完整：每个阶段都有出口，下注街可以提前结束（其余玩家弃牌）', () => {
    for (const ph of Object.keys(PHASE_TRANSITIONS) as Phase[]) expect(PHASE_TRANSITIONS[ph].length).toBeGreaterThan(0);
    for (const ph of ['preflop', 'flop', 'turn', 'river'] as Phase[]) expect(canTransition(ph, 'complete')).toBe(true);
    expect(canTransition('preflop', 'river')).toBe(false);
    expect(canTransition('flop', 'showdown')).toBe(false);
    expect(canTransition('complete', 'flop')).toBe(false);
    expect(STREET_STEPS).toEqual(['preflop', 'flop', 'turn', 'river', 'showdown']);
  });

  it('400 张随机牌桌 × 25 手：所有阶段跳转合法；动作只在下注街出现；每手以派奖结束', () => {
    let transitions = 0;
    let hands = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const { e, rng } = randomTable(seed);
      let last: Phase = e.phase;
      const check = () => {
        if (e.phase !== last) {
          expect(canTransition(last, e.phase), `${last} → ${e.phase}（种子 ${seed}）`).toBe(true);
          transitions++;
          last = e.phase;
        }
      };
      for (let h = 0; h < 25 && e.canStartHand(); h++) {
        e.startHand();
        check();
        hands++;
        let guard = 0;
        while (e.isHandActive() && guard++ < 200) {
          if (e.pendingAdvance) e.advance();
          else {
            const cur = e.currentPlayer!;
            const l = e.getLegalActions(cur.id)!;
            expect(PHASE_ACTIONS[e.phase].length).toBeGreaterThan(0);
            const r = rng();
            if (r < 0.15 && l.canFold) e.act(cur.id, { type: 'fold' });
            else if (r < 0.3 && l.canRaise) e.act(cur.id, { type: 'raise', amount: l.minRaiseTo + Math.floor(rng() * (l.maxRaiseTo - l.minRaiseTo)) });
            else if (r < 0.36 && l.canAllIn) e.act(cur.id, { type: 'allin' });
            else e.act(cur.id, { type: l.canCheck ? 'check' : 'call' });
          }
          check();
        }
        expect(e.phase).toBe('complete');
        // 事件顺序：handStart 在最前，win 在 handEnd 之前，且只有一个 win
        const types = e.events.map((x) => x.type);
        expect(types[0]).toBe('handStart');
        expect(types.filter((t) => t === 'win').length).toBe(1);
        expect(types.indexOf('win')).toBeLessThan(types.indexOf('handEnd'));
      }
    }
    expect(hands).toBeGreaterThan(2000);
    expect(transitions).toBeGreaterThan(hands * 2);
  });

  it('非法跳转会被拒绝（引擎不会在错误的阶段继续发牌）', () => {
    const { e } = randomTable(3);
    e.startHand();
    (e as any).phase = 'complete';
    expect(() => (e as any).setPhase('river')).toThrow(PokerError);
    // 派奖阶段不能行动
    const id = e.players[0].id;
    expect(e.getLegalActions(id)).toBeNull();
  });
});
