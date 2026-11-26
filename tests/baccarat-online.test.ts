// 百家乐：控制器节奏、在线房间（真实服务器 + 真实客户端校验）、服务器裁决、隐藏信息、重连、重复 / 非法命令、账号结算
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import { openDatabase } from '../server/db/database';
import { AccountService } from '../server/account/accounts';
import { RoomServer } from '../server/rooms';
import { BaccaratController } from '../src/core/baccarat/controller';
import { rigBacNext } from '../src/core/baccarat/debug';
import type { BaccaratView } from '../src/core/baccarat/types';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import type { RoomInfo, ServerMessage } from '../src/core/protocol';
import { parseServerMessage } from '../src/net/validate';
import { seededRandom } from '../src/core/utils/random';
import { factsFromBacView } from '../src/progress/baccaratTracker';
import { normalizeStats } from '../src/progress/progression';
import { applyBaccaratRound } from '../src/progress/rewards';
import { baccaratRates, mergeGuestBaccarat, normalizeBaccarat } from '../src/progress/baccaratStats';
import { REFILL_USED_UP, ROOM_REBUYS_USED_UP, refillDay } from '../src/core/refill';

const g = globalThis as any;
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
};
g.window ??= globalThis;
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
g.sessionStorage ??= mem();
g.localStorage ??= mem();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 8000, what = '') {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('等待超时 ' + what);
    await wait(10);
  }
}
const prof = (name: string) => ({ name, animal: DEFAULT_ANIMAL, level: 1 });
const DEALER = { profile: prof('庄家'), trait: '' };

// ───────────── 控制器 ─────────────

function ctrl(seats: { id: string; isAI?: boolean; chips?: number }[], o: object = {}) {
  const c = new BaccaratController(
    seats.map((s) => ({ id: s.id, profile: prof(s.id), chips: s.chips ?? 1000, isAI: !!s.isAI, aiPersonality: s.isAI ? ('crazyFrog' as const) : undefined })),
    { dealer: DEALER, autoRun: false, pace: 1, rng: seededRandom(3), aiRng: seededRandom(4), ...o },
  );
  c.start();
  return c;
}
function run(c: BaccaratController, until: () => boolean = () => false, max = 80) {
  for (let i = 0; i < max && !until() && c.nextWakeAt() !== null; i++) c.tick(c.nextWakeAt()!);
}

describe('百家乐控制器', () => {
  it('BACO-01 单人桌：下注没有倒计时；确认后停止下注 → 逐张开牌 → 结算；结束后等玩家点下一局', () => {
    const rounds: string[] = [];
    const c = ctrl([{ id: 'me' }], { solo: true });
    c.hooks = { onRound: (r, id) => rounds.push(id + ':' + r.length) };
    run(c, () => c.engine.phase === 'betting');
    expect(c.nextWakeAt()).toBeNull();
    expect(c.handle('me', { type: 'bet', bets: { banker: 100 } }, { round: 1 })).toBeNull();
    run(c, () => c.engine.phase === 'closed');
    const seen: number[] = [];
    while (c.engine.phase !== 'round-end') {
      c.tick(c.nextWakeAt()!);
      seen.push(c.getView('me').hands.player.cards.length + c.getView('me').hands.banker.cards.length);
    }
    expect(seen.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(rounds).toEqual([`${c.engine.roundId}:1`]);
    expect(c.nextWakeAt()).toBeNull();
    expect(c.handle('me', { type: 'next' }, { round: 1 })).toBeNull();
    run(c, () => c.engine.phase === 'betting');
    expect(c.engine.round).toBe(2);
  });

  it('BACO-02 隐藏信息：每一步的视图里只有已经公开的牌；结果与派彩在全部公开之后才出现', () => {
    const c = ctrl([{ id: 'a' }, { id: 'b' }]);
    run(c, () => c.engine.phase === 'betting');
    c.handle('a', { type: 'bet', bets: { player: 100 } }, { round: 1 });
    c.handle('b', { type: 'bet', bets: { tie: 50 } }, { round: 1 });
    run(c, () => c.engine.phase === 'closed');
    const all = [...c.engine.coup.player, ...c.engine.coup.banker].map((x) => x.uid);
    for (let step = 0; c.engine.phase !== 'round-end'; step++) {
      for (const id of ['a', 'b', 'spectator']) {
        const v = c.getView(id);
        const text = JSON.stringify(v);
        const shown = [...v.hands.player.cards, ...v.hands.banker.cards].map((x) => x.uid);
        for (const uid of all) if (!shown.includes(uid)) expect(text.includes(`"${uid}"`)).toBe(false);
        expect(text).not.toContain('"order"');
        if (v.phase !== 'round-end') {
          expect(v.result).toBeNull();
          expect(v.players.every((p) => p.returns === null)).toBe(true);
        }
      }
      c.tick(c.nextWakeAt()!);
    }
    expect(c.getView('a').result).not.toBeNull();
  });

  it('BACO-03 多人桌：第一个人下注后开始倒计时；没下注的到时跳过；全部下注立刻停止；之后的下注被拒绝', () => {
    const c = ctrl([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { betTimeMs: 5000 });
    run(c, () => c.engine.phase === 'betting');
    expect(c.getView('a').turnDeadline).toBeNull();
    c.handle('a', { type: 'bet', bets: { player: 100 } }, { round: 1 });
    expect(c.getView('a').turnDeadline).not.toBeNull();
    c.handle('b', { type: 'skip' }, { round: 1 });
    c.tick(c.nextWakeAt()!);
    expect(c.engine.phase).toBe('closed');
    expect(c.engine.getPlayer('c')!.skipped).toBe(true);
    expect(c.handle('c', { type: 'bet', bets: { player: 100 } }, { round: 1 })).toBe('已经停止下注');
    const d = ctrl([{ id: 'a' }, { id: 'b' }]);
    run(d, () => d.engine.phase === 'betting');
    d.handle('a', { type: 'bet', bets: { banker: 50 } }, { round: 1 });
    d.handle('b', { type: 'bet', bets: { player: 50 } }, { round: 1 });
    d.tick(d.nextWakeAt()!);
    expect(d.engine.phase).toBe('closed');
  });

  it('BACO-04 非法命令：过期局号、重复下注、负数 / NaN / 超额、AI 座位、陌生人、未知命令全部拒绝，余额不变', () => {
    const c = ctrl([{ id: 'me' }, { id: 'ai', isAI: true }], { solo: true });
    run(c, () => c.engine.phase === 'betting');
    const bal = c.engine.getPlayer('me')!.balance;
    expect(c.handle('me', { type: 'bet', bets: { player: 100 } }, { round: 0 })).toBe('这一局已经结束');
    for (const bets of [{ player: -1 }, { player: NaN }, { player: 1e9 }, { player: 0 }, { dragon: 10 }] as object[]) expect(c.handle('me', { type: 'bet', bets }, { round: 1 })).not.toBeNull();
    expect(c.handle('ai', { type: 'bet', bets: { player: 100 } }, { round: 1 })).toBe('你不在这张牌桌上');
    expect(c.handle('nobody', { type: 'skip' }, { round: 1 })).toBe('你不在这张牌桌上');
    expect(c.handle('me', { type: 'fold' } as never, { round: 1 })).toBe('无效操作');
    expect(c.engine.getPlayer('me')!.balance).toBe(bal);
    expect(c.handle('me', { type: 'bet', bets: { player: 100 } }, { round: 1 })).toBeNull();
    expect(c.handle('me', { type: 'bet', bets: { player: 100 } }, { round: 1 })).toBe('你已经下注了');
    expect(c.engine.getPlayer('me')!.balance).toBe(bal - 100);
  });

  it('BACO-05 一局中途离开：按真实结果结算一次（可以赢也可以输），之后的派彩不再算他', () => {
    const c = ctrl([{ id: 'a' }, { id: 'b' }]);
    run(c, () => c.engine.phase === 'betting');
    c.engine = rigBacNext(c.engine, ['9s', '7d', 'Kc', 'Kh']);
    c.handle('a', { type: 'bet', bets: { player: 100 } }, { round: 1 });
    c.handle('b', { type: 'bet', bets: { banker: 100 } }, { round: 1 });
    run(c, () => c.engine.phase === 'dealing');
    const fa = c.leaveFacts('a')!;
    const fb = c.leaveFacts('b')!;
    expect([fa.winner, fa.profit, fb.profit]).toEqual(['player', 100, -100]);
    c.removePlayer('a');
    expect(c.leaveFacts('a')).toBeNull();
    const results: string[] = [];
    c.hooks = { onRound: (r) => results.push(...r.map((x) => x.playerId)) };
    run(c, () => c.engine.phase === 'round-end');
    expect(results).toEqual(['b']);
  });

  it('BACO-06 筹码用完：可以补给；保存 / 恢复（开牌途中）后结果一致；同桌 AI 自己下注', () => {
    const c = ctrl([{ id: 'me', chips: 5 }, { id: 'ai', isAI: true }], { solo: true });
    run(c, () => c.engine.phase === 'betting');
    expect(c.engine.getPlayer('ai')!.placed).toBe(true);
    expect(c.handle('me', { type: 'bet', bets: { player: 10 } }, { round: 1 })).toBe('金币不足');
    expect(c.handle('me', { type: 'rebuy' }, { round: 1 })).toBeNull();
    expect(c.engine.getPlayer('me')!.balance).toBe(1000);
    expect(c.handle('me', { type: 'rebuy' }, { round: 1 })).toBe('筹码还够，不需要补充');
    c.handle('me', { type: 'bet', bets: { banker: 200 } }, { round: 1 });
    run(c, () => c.engine.phase === 'dealing');
    const copy = BaccaratController.fromState(JSON.parse(JSON.stringify(c.toState())));
    run(c, () => c.engine.phase === 'round-end');
    run(copy, () => copy.engine.phase === 'round-end');
    expect(copy.engine.players.map((p) => p.balance)).toEqual(c.engine.players.map((p) => p.balance));
  });

  it('BACO-07 统计：胜率不含平局；押闲 / 押庄胜率去掉开和退回；押和命中率；净输赢另外计算', () => {
    let s = normalizeStats({});
    const f = (winner: 'player' | 'banker' | 'tie', bets: { player?: number; banker?: number; tie?: number }, payout: number) => {
      const b = { player: bets.player ?? 0, banker: bets.banker ?? 0, tie: bets.tie ?? 0 };
      const bet = b.player + b.banker + b.tie;
      s = applyBaccaratRound(s, { roundId: Math.random().toString(), bets: b, returns: b, bet, payout, profit: payout - bet, winner, playerScore: 0, bankerScore: 0, natural: false }).stats;
    };
    f('player', { player: 100 }, 200);
    f('banker', { player: 100 }, 0);
    f('tie', { player: 100 }, 100);
    f('banker', { banker: 100 }, 195);
    f('tie', { tie: 10 }, 90);
    const r = baccaratRates(s.baccarat);
    expect(s.baccarat).toMatchObject({ rounds: 5, wins: 3, losses: 1, pushes: 1, playerBets: 3, playerBetWins: 1, playerBetPushes: 1, bankerBetWins: 1, tieBetWins: 1, tieResults: 2 });
    expect(r).toMatchObject({ winRate: '75.0%', playerBetWinRate: '50.0%', bankerBetWinRate: '100.0%', tieBetWinRate: '100.0%', profit: 175 });
    const merged = mergeGuestBaccarat(normalizeBaccarat({}), normalizeBaccarat({ rounds: 5, wins: 99, tieBetWins: 99, tieBets: 1 }), { rounds: 3, chips: 1000 });
    expect([merged.rounds, merged.wins, merged.tieBetWins]).toEqual([3, 3, 1]);
  });
});

// ───────────── 在线房间（真实服务器） ─────────────

const SET = { gameMode: 'baccarat', maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 };
let srv: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  srv = await createServer(0, { pace: 0.02, turnTimeMs: 2000, lobbyGraceMs: 3000, disconnectGraceMs: 80, connLimits: { perIp: 1000, perMinute: 10000 } });
});
afterAll(async () => {
  await srv.close();
});

class Player {
  ws!: WebSocket;
  msgs: ServerMessage[] = [];
  raw: string[] = [];
  sessionId = '';
  playerId = '';
  room: RoomInfo | null = null;
  bac: BaccaratView | null = null;
  errors: string[] = [];
  n = 0;
  constructor(public name: string) {}
  async connect(sessionId?: string) {
    this.ws = new WebSocket(`ws://localhost:${srv.port}/api/ws`);
    this.ws.on('message', (d) => {
      this.raw.push(d.toString());
      const m = parseServerMessage(d.toString());
      if (!m) throw new Error('客户端会丢弃这条消息：' + d.toString().slice(0, 200));
      this.msgs.push(m);
      if (m.t === 'welcome') (this.sessionId = m.sessionId), (this.playerId = m.playerId);
      if (m.t === 'room') {
        this.room = m.room;
        if (!m.room || m.room.status === 'lobby') this.bac = null;
      }
      if (m.t === 'bacState') {
        const prev = this.bac;
        this.bac =
          m.view.eventsDelta && prev && prev.round === m.view.round
            ? { ...m.view, events: [...prev.events, ...m.view.events.filter((e) => e.seq > (prev.events.at(-1)?.seq ?? 0))], players: m.view.players.map((p) => (p.profile ? p : { ...p, profile: prev.players.find((x) => x.id === p.id)!.profile })) }
            : m.view;
      }
      if (m.t === 'error') this.errors.push(m.message);
    });
    await new Promise<void>((r, j) => {
      this.ws.on('open', () => r());
      this.ws.on('error', j);
    });
    this.playerId = '';
    this.send({ t: 'hello', sessionId, profile: { name: this.name, animal: DEFAULT_ANIMAL } });
    await until(() => !!this.playerId);
    return this;
  }
  send(m: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  cmd(cmd: unknown, extra: object = {}) {
    const actionId = `${this.name.length}x${++this.n}`;
    this.send({ t: 'bac', cmd, actionId, round: this.bac?.round, ...extra });
    return actionId;
  }
  acks(id: string) {
    return this.msgs.filter((m) => m.t === 'ack' && m.actionId === id) as Extract<ServerMessage, { t: 'ack' }>[];
  }
  get me() {
    return this.bac?.players.find((p) => p.id === this.playerId);
  }
}

async function table(n: number) {
  const ps: Player[] = [];
  for (let i = 0; i < n; i++) ps.push(await new Player(['阿福', '布丁', '团子', '旺财', '咕咕', '奶茶'][i]).connect());
  ps[0].send({ t: 'createRoom', settings: SET });
  await until(() => !!ps[0].room);
  const code = ps[0].room!.code;
  for (const p of ps.slice(1)) p.send({ t: 'joinRoom', code });
  await until(() => ps[0].room!.members.length === n);
  for (const p of ps.slice(1)) p.send({ t: 'ready', ready: true });
  await until(() => ps[0].room!.members.every((m) => m.ready));
  ps[0].send({ t: 'startGame' });
  await until(() => ps.every((p) => p.bac?.phase === 'betting'), 8000, '进入下注');
  return { ps, code };
}
async function rig(code: string, cards: string[]) {
  await (srv.rooms as any).mutate(code, null, (tx: any) => {
    const c = tx.baccarat();
    c.engine = rigBacNext(c.engine, cards);
    tx.touch();
  });
}
const closeAll = (ps: Player[]) => ps.forEach((p) => (p.send({ t: 'leaveRoom' }), p.ws.close()));

describe('百家乐在线', () => {
  it('BACO-08 建百家乐房间：加入的人自动进入百家乐（不会出现房主百家乐、客人德州）', async () => {
    const { ps } = await table(2);
    expect(ps.map((p) => [p.room!.settings.gameMode, p.bac!.kind])).toEqual([
      ['baccarat', 'baccarat'],
      ['baccarat', 'baccarat'],
    ]);
    expect(ps.every((p) => p.msgs.every((m) => m.t !== 'state' && m.t !== 'bjState'))).toBe(true);
    closeAll(ps);
  });

  for (const n of [2, 4, 6])
    it(`BACO-09 ${n} 名玩家共用一张牌桌：同样的牌、同样的结果，各自的下注与派彩独立`, async () => {
      const { ps, code } = await table(n);
      await rig(code, ['9s', '7d', 'Kc', 'Kh']); // 闲 9 例牌胜庄 7
      const spots = ['player', 'banker', 'tie'] as const;
      ps.forEach((p, i) => p.cmd({ type: 'bet', bets: { [spots[i % 3]]: 100 } }));
      await until(() => ps.every((p) => p.bac?.phase === 'round-end'), 10000, '结束');
      const sig = (p: Player) => JSON.stringify([p.bac!.roundId, p.bac!.hands, p.bac!.result]);
      expect(new Set(ps.map(sig)).size).toBe(1);
      expect(ps[0].bac!.result).toEqual({ winner: 'player', player: 9, banker: 7 });
      const want = ps.map((_, i) => (spots[i % 3] === 'player' ? 1100 : 900));
      for (const p of ps) expect(p.bac!.players.map((x) => x.balance)).toEqual(want);
      closeAll(ps);
    });

  it('BACO-10 原始网络数据：任何客户端在一张牌公开之前都收不到它；收不到牌靴顺序', async () => {
    const { ps, code } = await table(2);
    ps.forEach((p) => p.cmd({ type: 'bet', bets: { banker: 50 } }));
    await until(() => ps[0].bac?.phase === 'closed' || ps[0].bac?.phase === 'dealing', 8000);
    const rec = (srv.rooms as any).cache.get(code).room;
    const coup = rec.bac.engine.coup;
    const all: string[] = [...coup.player, ...coup.banker].map((c: { uid: string }) => c.uid);
    await until(() => ps.every((p) => p.bac?.phase === 'round-end'), 10000);
    for (const p of ps) {
      const firstSeen = (uid: string) => p.raw.findIndex((r) => r.includes(`"${uid}"`));
      for (const uid of all) {
        const at = firstSeen(uid);
        expect(at).toBeGreaterThanOrEqual(0);
        // 第一次出现时，它一定是这条消息里已经公开的牌
        const v = JSON.parse(p.raw[at]).view as BaccaratView;
        expect([...v.hands.player.cards, ...v.hands.banker.cards].some((c) => c.uid === uid)).toBe(true);
      }
      expect(p.raw.some((r) => r.includes('"order"') || r.includes('"coup"') || r.includes('"plan"'))).toBe(false);
    }
    closeAll(ps);
  });

  it('BACO-11 非法 / 重复 / 迟到的下注：服务器拒绝，余额不变；同一 actionId 只执行一次', async () => {
    const { ps } = await table(2);
    const [a, b] = ps;
    const bal = a.me!.balance;
    const bad: object[] = [{ player: -5 }, { player: 0 }, { player: 12.5 }, { tie: 1e9 }, { dragon: 50 }, { player: '50' }];
    for (const [i, bets] of bad.entries()) a.send({ t: 'bac', cmd: { type: 'bet', bets }, actionId: 'bad' + i, round: a.bac!.round });
    a.send({ t: 'bac', cmd: { type: 'bet', bets: { player: 50 } }, actionId: 'old', round: a.bac!.round - 1 });
    a.send({ t: 'bac', cmd: { type: 'bet', bets: { player: 50 } }, actionId: 'noround' });
    await until(() => bad.every((_, i) => a.acks('bad' + i).length === 1) && a.acks('old').length === 1 && a.acks('noround').length === 1);
    expect([...bad.map((_, i) => a.acks('bad' + i)[0].ok), a.acks('old')[0].ok, a.acks('noround')[0].ok].every((x) => x === false)).toBe(true);
    expect(a.me!.balance).toBe(bal);
    const m = { t: 'bac', cmd: { type: 'bet', bets: { player: 50 } }, actionId: 'dup', round: a.bac!.round };
    for (let i = 0; i < 5; i++) a.send(m);
    await until(() => a.acks('dup').length >= 2);
    await wait(150);
    expect(a.acks('dup').filter((x) => x.ok && !x.duplicate).length).toBe(1);
    await until(() => a.me!.balance === bal - 50);
    b.cmd({ type: 'bet', bets: { banker: 50 } });
    await until(() => a.bac!.phase !== 'betting', 8000);
    const late = a.cmd({ type: 'bet', bets: { tie: 20 } });
    await until(() => a.acks(late).length === 1);
    expect(a.acks(late)[0].message).toBe('已经停止下注');
    closeAll(ps);
  });

  it('BACO-12 开牌途中断线再重连：同一局、同一座位、下注还在；只看到已经公开的牌', async () => {
    const { ps, code } = await table(2);
    const [a, b] = ps;
    a.cmd({ type: 'bet', bets: { player: 100 } });
    b.cmd({ type: 'bet', bets: { banker: 100 } });
    await until(() => b.bac?.phase === 'dealing', 8000);
    const round = b.bac!.roundId;
    b.ws.close();
    await wait(150);
    const b2 = await new Player('布丁').connect(b.sessionId);
    await until(() => !!b2.bac, 5000);
    expect([b2.playerId, b2.bac!.roundId, b2.me!.bets.banker]).toEqual([b.playerId, round, 100]);
    const rec = (srv.rooms as any).cache.get(code).room;
    const shown = rec.bac.engine.revealed;
    const vis = b2.bac!.hands.player.cards.length + b2.bac!.hands.banker.cards.length;
    expect(vis).toBeLessThanOrEqual(shown);
    await until(() => b2.bac?.phase === 'round-end', 10000);
    expect(b2.bac!.players.find((p) => p.id === b2.playerId)!.returns).not.toBeNull();
    closeAll([a, b2]);
  });

  it('BACO-13 一局中不能切换模式；结束后房主返回大厅可以切换', async () => {
    const { ps } = await table(2);
    const [a, b] = ps;
    a.cmd({ type: 'bet', bets: { player: 50 } });
    b.cmd({ type: 'bet', bets: { player: 50 } });
    await until(() => a.bac!.phase !== 'betting', 8000);
    a.send({ t: 'backToLobby' });
    await until(() => a.errors.some((e) => e.includes('这一局结束后')), 5000);
    await until(() => a.bac?.phase === 'round-end', 10000);
    a.send({ t: 'backToLobby' });
    await until(() => a.room?.status === 'lobby' && b.room?.status === 'lobby');
    a.send({ t: 'setMode', gameMode: 'blackjack-21' });
    await until(() => b.room?.settings.gameMode === 'blackjack-21');
    closeAll(ps);
  });

  it('BACO-17 多人房间：每人最多补充 3 次桌上筹码，第 4 次拒绝、余额不变；次数显示在各自的视图里', async () => {
    const { ps, code } = await table(2);
    const [a, b] = ps;
    const broke = () =>
      (srv.rooms as any).mutate(code, null, (tx: any) => {
        tx.baccarat().engine.setBalance(a.playerId, 0);
        tx.touch();
      });
    expect([a.bac!.refillsLeft, b.bac!.refillsLeft]).toEqual([3, 3]);
    for (let i = 1; i <= 3; i++) {
      await broke();
      const id = a.cmd({ type: 'rebuy' });
      await until(() => a.acks(id).length === 1 && a.bac!.refillsLeft === 3 - i, 5000, '补充 ' + i);
      expect(a.acks(id)[0].ok).toBe(true);
      expect(a.me!.balance).toBe(SET.startingChips);
    }
    await broke();
    const id = a.cmd({ type: 'rebuy' });
    await until(() => a.acks(id).length === 1);
    expect([a.acks(id)[0].ok, a.acks(id)[0].message]).toEqual([false, ROOM_REBUYS_USED_UP]);
    expect((srv.rooms as any).cache.get(code).room.bac.engine.players.find((p: any) => p.id === a.playerId).balance).toBe(0);
    // 另一名玩家的次数不受影响
    await until(() => b.bac!.refillsLeft === 3);
    closeAll(ps);
  });
});

describe('百家乐账号结算', () => {
  const setup = () => {
    const db = openDatabase(':memory:');
    const accounts = new AccountService(db);
    const { userId } = accounts.loginWithIdentity({ provider: 'dev', subject: 'bac', name: '测试' });
    const rooms = new RoomServer({ pace: 0.01, turnTimeMs: 500, disconnectGraceMs: 50, accounts });
    const conn = (uid: string) => {
      const out: { msgs: any[]; bac: BaccaratView | null; room: any; h: any; send: (m: any) => void; cmd: (c: any) => void } = { msgs: [], bac: null, room: null, h: null, send: () => undefined, cmd: () => undefined };
      out.h = rooms.connect({ send: (m) => { const x = JSON.parse(JSON.stringify(m)); out.msgs.push(x); if (x.t === 'room') out.room = x.room; if (x.t === 'bacState') out.bac = x.view.eventsDelta && out.bac ? { ...x.view, events: [...out.bac.events, ...x.view.events] } : x.view; } }, { userId: uid });
      out.send = (m) => out.h.onMessage(JSON.stringify(m));
      out.cmd = (c) => out.send({ t: 'bac', cmd: c, actionId: 'a' + out.msgs.length + Math.random().toString(36).slice(2, 8), round: out.bac?.round });
      out.send({ t: 'hello', profile: { name: 'x', animal: DEFAULT_ANIMAL } });
      return out;
    };
    const rigRoom = (code: string, cards: string[]) =>
      (rooms as any).mutate(code, null, (tx: any) => {
        const c = tx.baccarat();
        c.engine = rigBacNext(c.engine, cards);
        tx.touch();
      });
    return { accounts, userId, rooms, conn, rigRoom };
  };
  const SOLO = { opponents: [], startingChips: 1000, smallBlind: 10, bigBlind: 20, baccarat: { dealer: 'lion', tier: 'low' } };

  it('BACO-14 单人桌：账号虚拟筹码、经验、统计、成就各结算一次；庄赢抽 5%', async () => {
    const { accounts, userId, rooms, conn, rigRoom } = setup();
    const a = conn(userId);
    a.send({ t: 'startSolo', settings: SOLO });
    await until(() => a.bac?.phase === 'betting');
    expect([a.bac!.economy, a.bac!.solo, a.bac!.dealer.profile.animal.species]).toEqual(['profile', true, 'lion']);
    const start = accounts.chipsOf(userId);
    await rigRoom(a.room.code, ['7s', '9d', 'Kc', 'Kh']); // 庄 9 例牌
    a.cmd({ type: 'bet', bets: { banker: 100 } });
    await until(() => a.bac?.phase === 'round-end', 6000);
    const st = accounts.getState(userId);
    expect(accounts.chipsOf(userId)).toBe(start + 95 + Object.keys(st.achievements).length * 100);
    expect(st.stats.baccarat).toMatchObject({ rounds: 1, bankerBetWins: 1, wins: 1, naturals: 1 });
    expect(st.achievements.bac_first && st.achievements.bac_banker).toBeTruthy();
    rooms.dispose();
  });

  it('BACO-15 单人桌一局中途离开：按真实结果结算一次（不能靠离开逃掉输的注）', async () => {
    const { accounts, userId, rooms, conn, rigRoom } = setup();
    const a = conn(userId);
    a.send({ t: 'startSolo', settings: SOLO });
    await until(() => a.bac?.phase === 'betting');
    await rigRoom(a.room.code, ['9s', '7d', 'Kc', 'Kh']); // 闲赢
    const start = accounts.chipsOf(userId);
    a.cmd({ type: 'bet', bets: { banker: 100 } });
    await until(() => a.bac?.phase === 'dealing' || a.bac?.phase === 'closed', 6000);
    a.send({ t: 'leaveRoom' });
    await until(() => a.room === null);
    await wait(100);
    expect(accounts.chipsOf(userId)).toBe(start - 100 + Object.keys(accounts.getState(userId).achievements).length * 100);
    expect(accounts.getState(userId).stats.baccarat.rounds).toBe(1);
    rooms.dispose();
  });

  it('BACO-18 单人桌（账号）：补给每天 3 次，用完后服务器拒绝并说明原因；视图显示今天还剩几次', async () => {
    const { accounts, userId, rooms, conn } = setup();
    const db = (accounts as any).db;
    const today = refillDay();
    const play = async (used: number) => {
      db.prepare('UPDATE player_progress SET virtual_chips = 3, refill_day = ?, refill_used = ? WHERE user_id = ?').run(today, used, userId);
      const a = conn(userId);
      a.send({ t: 'startSolo', settings: SOLO });
      await until(() => a.bac?.phase === 'betting');
      expect(a.bac!.refillsLeft).toBe(3 - used);
      a.send({ t: 'bac', cmd: { type: 'rebuy' }, actionId: 'rb' + used, round: a.bac!.round });
      await until(() => a.msgs.some((m) => m.t === 'ack' && m.actionId === 'rb' + used));
      const ack = a.msgs.find((m) => m.t === 'ack' && m.actionId === 'rb' + used);
      return { a, ack };
    };
    const full = await play(3);
    expect([full.ack.ok, full.ack.message]).toEqual([false, REFILL_USED_UP]);
    expect(accounts.chipsOf(userId)).toBe(3);
    full.a.send({ t: 'leaveRoom' });
    await until(() => full.a.room === null);
    const last = await play(2);
    expect(last.ack.ok).toBe(true);
    await until(() => last.a.bac!.players[0].balance === 500 && last.a.bac!.refillsLeft === 0);
    expect(accounts.chipsOf(userId)).toBe(500);
    expect(accounts.refillsLeft(userId)).toBe(0);
    rooms.dispose();
  });

  it('BACO-16 游客在线：只按服务器的结果记录；数据库升级到第 3 版，旧玩家的百家乐统计从 0 开始', () => {
    const v = { kind: 'baccarat', phase: 'round-end', roundId: 'r', viewerId: 'me', result: { winner: 'tie', player: 6, banker: 6 }, hands: { player: { natural: false }, banker: { natural: false } }, players: [{ id: 'me', placed: true, bets: { player: 100, banker: 0, tie: 10 }, returns: { player: 100, banker: 0, tie: 90 } }] } as unknown as BaccaratView;
    expect(factsFromBacView(v)).toMatchObject({ bet: 110, payout: 190, profit: 80, winner: 'tie' });
    const db = openDatabase(':memory:');
    const acc = new AccountService(db);
    const { userId } = acc.loginWithIdentity({ provider: 'dev', subject: 'old' });
    db.exec("UPDATE player_statistics SET baccarat = 'not json'");
    expect(acc.getState(userId).stats.baccarat.rounds).toBe(0);
    // 第 3 版加入百家乐统计；之后的版本（第 4 版：补给次数）由 REF-04 检查
    expect((db.prepare('SELECT version FROM schema_meta').get() as { version: number }).version).toBeGreaterThanOrEqual(3);
  });
});
