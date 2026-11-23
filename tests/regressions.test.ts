// 深度审计中修复的问题：每一个都有对应的回归测试
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { TimerBag } from '../src/animation/timerBag';
import { ProgressGate } from '../src/progress/progressGate';
import { parseServerMessage } from '../src/net/validate';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
};
const g = globalThis as any;
g.window ??= globalThis;
g.localStorage ??= mem();
g.sessionStorage ??= mem();

describe('BUG-01 离开牌桌后，事件导演排好的音效 / 动画 / 赢家演出不能继续播放', () => {
  it('到点执行后自动移除（不会越积越多）；cancelAll 后一个都不会再执行', () => {
    vi.useFakeTimers();
    try {
      const bag = new TimerBag();
      const ran: string[] = [];
      bag.later(() => ran.push('a'), 100);
      bag.later(() => ran.push('b'), 500);
      bag.later(() => ran.push('c'), 2000);
      expect(bag.size).toBe(3);
      vi.advanceTimersByTime(150);
      expect(ran).toEqual(['a']);
      expect(bag.size).toBe(2);
      // 离开牌桌
      bag.cancelAll();
      expect(bag.size).toBe(0);
      vi.advanceTimersByTime(5000);
      expect(ran).toEqual(['a']);
      // 长时间对局：执行过的任务不会留在集合里
      for (let i = 0; i < 1000; i++) bag.later(() => undefined, i % 7);
      vi.advanceTimersByTime(10);
      expect(bag.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BUG-02 / BUG-03 奖励结算：每手、每场只结算一次，不重复也不漏发', () => {
  const v = (handNumber: number, phase: string, extra: { summary?: boolean; gameOver?: boolean } = {}) =>
    ({ handNumber, phase, summary: extra.summary || phase === 'complete' ? ({} as any) : null, gameOver: extra.gameOver ? ({} as any) : null }) as any;

  it('同一手牌的多次状态更新只结算一次', () => {
    const gate = new ProgressGate();
    expect(gate.check(v(0, 'idle'))).toEqual({ hand: false, game: false });
    expect(gate.check(v(1, 'preflop'))).toEqual({ hand: false, game: false });
    expect(gate.check(v(1, 'complete'))).toEqual({ hand: true, game: false });
    expect(gate.check(v(1, 'complete'))).toEqual({ hand: false, game: false });
    expect(gate.check(v(2, 'complete'))).toEqual({ hand: true, game: false });
  });

  it('离开后进入新的一场（没有经过第 0 手）：同样编号的那一手照常结算，不会被上一场的记录挡住', () => {
    const gate = new ProgressGate();
    gate.check(v(1, 'preflop'));
    for (let h = 1; h <= 7; h++) gate.check(v(h, 'complete'));
    gate.reset(); // 离开牌桌
    // 新一场：第一次看到的就是第 7 手进行中（例如加入一场已经开始的对局），编号正好等于上一场的最后一手
    expect(gate.check(v(7, 'turn')).hand).toBe(false);
    expect(gate.check(v(7, 'complete')).hand).toBe(true);
    expect(gate.check(v(8, 'complete')).hand).toBe(true);
  });

  it('刷新 / 重连时正好停在结算画面：已经结束的这一手和整场都不再重复发奖', () => {
    const gate = new ProgressGate();
    expect(gate.check(v(9, 'complete', { gameOver: true }))).toEqual({ hand: false, game: false });
    const g2 = new ProgressGate();
    g2.check(v(1, 'preflop'));
    expect(g2.check(v(1, 'complete', { gameOver: true }))).toEqual({ hand: true, game: true });
    expect(g2.check(v(1, 'complete', { gameOver: true }))).toEqual({ hand: false, game: false });
  });
});

describe('BUG-05 服务器消息结构校验：坏消息被丢弃，界面不会崩溃', () => {
  const view = { viewerId: 'u1', handNumber: 1, phase: 'preflop', board: [], events: [{ type: 'handStart', seq: 1 }], players: [{ id: 'u1', chips: 100, hole: [] }], potTotal: 0, serverTime: 1 };
  it('正常消息通过', () => {
    expect(parseServerMessage(JSON.stringify({ t: 'welcome', sessionId: 's', playerId: 'p' }))?.t).toBe('welcome');
    expect(parseServerMessage(JSON.stringify({ t: 'state', view }))?.t).toBe('state');
    expect(parseServerMessage(JSON.stringify({ t: 'room', room: null }))?.t).toBe('room');
    expect(parseServerMessage(JSON.stringify({ t: 'room', room: { code: 'ABCDEF', hostId: 'u1', status: 'lobby', settings: {}, members: [{ id: 'u1' }] } }))?.t).toBe('room');
    expect(parseServerMessage(JSON.stringify({ t: 'ack', actionId: 'a1', ok: true }))?.t).toBe('ack');
    expect(parseServerMessage(JSON.stringify({ t: 'chat', message: { id: '1', from: 'u1', name: 'x', text: 'hi', kind: 'chat', time: 1 } }))?.t).toBe('chat');
  });
  it('格式错误 / 缺少字段 / 类型不对 / 未知类型的消息被拒绝', () => {
    const bad: unknown[] = [
      '{oops',
      42,
      JSON.stringify(null),
      JSON.stringify([1, 2]),
      JSON.stringify({ x: 1 }),
      JSON.stringify({ t: 'hack' }),
      JSON.stringify({ t: 'welcome', sessionId: 5 }),
      JSON.stringify({ t: 'state' }),
      JSON.stringify({ t: 'state', view: { ...view, events: null } }),
      JSON.stringify({ t: 'state', view: { ...view, players: 'x' } }),
      JSON.stringify({ t: 'state', view: { ...view, players: [{ id: 'u1' }] } }),
      JSON.stringify({ t: 'state', view: { ...view, handNumber: 'one' } }),
      JSON.stringify({ t: 'room' }),
      JSON.stringify({ t: 'room', room: { code: 'A', members: 'x' } }),
      JSON.stringify({ t: 'chat', message: { id: 1 } }),
      JSON.stringify({ t: 'chatHistory', messages: [{ id: '1' }] }),
      JSON.stringify({ t: 'ack', actionId: 'a', ok: 'yes' }),
      JSON.stringify({ t: 'error' }),
    ];
    for (const b of bad) expect(parseServerMessage(b), String(b)).toBeNull();
  });
});

describe('BUG-07 动物创建器：同名角色不会因为首尾空格被保存成两份', () => {
  let useProfile: typeof import('../src/store/profileStore').useProfile;
  beforeAll(async () => {
    ({ useProfile } = await import('../src/store/profileStore'));
  });
  it('“ 小明 ” 和 “小明” 是同一个角色：第二次保存覆盖第一次，名字统一为整理后的', () => {
    const st = useProfile.getState();
    const before = st.characters.length;
    st.setName('小明');
    st.saveCharacter();
    useProfile.getState().setName(' 小明 ');
    useProfile.getState().saveCharacter();
    const list = useProfile.getState().characters.filter((c) => c.name.includes('小明'));
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('小明');
    expect(useProfile.getState().characters.length).toBe(before + 1);
  });
});
