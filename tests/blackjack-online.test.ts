// 21 点在线：服务器裁决、房间模式、同步、重连、重复消息、限流、离开、账号结算（真实服务器 + 真实客户端代码）
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import { openDatabase } from '../server/db/database';
import { AccountService } from '../server/account/accounts';
import { RoomServer } from '../server/rooms';
import { MemoryHub } from '../server/store';
import { BlackjackEngine } from '../src/core/blackjack/engine';
import { forceOutcome, rigNext } from '../src/core/blackjack/debug';
import type { BlackjackView } from '../src/core/blackjack/types';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import type { RoomInfo, ServerMessage } from '../src/core/protocol';
import { parseServerMessage } from '../src/net/validate';
import { seededRandom } from '../src/core/utils/random';
import { BlackjackGate, factsFromView } from '../src/progress/blackjackTracker';
import { EMPTY_STATS, normalizeStats, type Stats } from '../src/progress/progression';
import { REWARD, applyBlackjackRound, newAchievements } from '../src/progress/rewards';
import { mergeGuestBlackjack, normalizeBlackjack } from '../src/progress/blackjackStats';

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
const SET = { gameMode: 'blackjack-21', maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 };

let srv: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  srv = await createServer(0, { pace: 0.02, turnTimeMs: 900, lobbyGraceMs: 3000, disconnectGraceMs: 80, connLimits: { perIp: 1000, perMinute: 10000 } });
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
  bj: BlackjackView | null = null;
  errors: string[] = [];
  n = 0;
  constructor(public name: string, public port = srv.port) {}
  async connect(sessionId?: string) {
    this.ws = new WebSocket(`ws://localhost:${this.port}/api/ws`);
    this.ws.on('message', (d) => {
      this.raw.push(d.toString());
      const m = parseServerMessage(d.toString());
      if (!m) throw new Error('客户端会丢弃这条消息：' + d.toString().slice(0, 200));
      this.msgs.push(m);
      if (m.t === 'welcome') (this.sessionId = m.sessionId), (this.playerId = m.playerId);
      if (m.t === 'room') {
        this.room = m.room;
        if (!m.room || m.room.status === 'lobby') this.bj = null;
      }
      if (m.t === 'bjState') {
        const prev = this.bj;
        this.bj =
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
    this.send({ t: 'bj', cmd, actionId, round: this.bj?.round, token: this.bj?.token, ...extra });
    return actionId;
  }
  acks(id: string) {
    return this.msgs.filter((m) => m.t === 'ack' && m.actionId === id) as Extract<ServerMessage, { t: 'ack' }>[];
  }
  get me() {
    return this.bj?.players.find((p) => p.id === this.playerId);
  }
}

/** 建 21 点房间 → 加入 → 准备 → 开始 */
async function table(n: number, s: object = SET) {
  const ps: Player[] = [];
  for (let i = 0; i < n; i++) ps.push(await new Player(['阿福', '布丁', '团子', '旺财', '咕咕', '奶茶'][i]).connect());
  ps[0].send({ t: 'createRoom', settings: s });
  await until(() => !!ps[0].room);
  const code = ps[0].room!.code;
  for (const p of ps.slice(1)) p.send({ t: 'joinRoom', code });
  await until(() => ps[0].room!.members.length === n);
  for (const p of ps.slice(1)) p.send({ t: 'ready', ready: true });
  await until(() => ps[0].room!.members.every((m) => m.ready));
  ps[0].send({ t: 'startGame' });
  await until(() => ps.every((p) => p.bj?.phase === 'betting'), 8000, '进入下注');
  return { ps, code };
}
/** 指定接下来发出的牌（直接改服务器上的房间记录；测试专用） */
async function rig(code: string, cards: string[]) {
  await (srv.rooms as any).mutate(code, null, (tx: any) => {
    const c = tx.blackjack();
    const st = c.engine.toState();
    c.engine = BlackjackEngine.fromState({ ...st, shoe: rigNext(st.shoe, cards) });
    tx.touch();
  });
}
const closeAll = (ps: Player[]) => ps.forEach((p) => (p.send({ t: 'leaveRoom' }), p.ws.close()));

describe('房间与模式', () => {
  it('BJO-01 创建房间可以选 21 点；旧客户端不带模式时是德州；非法模式当作德州', async () => {
    const a = await new Player('阿福').connect();
    a.send({ t: 'createRoom', settings: SET });
    await until(() => a.room?.settings.gameMode === 'blackjack-21');
    const { gameMode: _g, ...old } = SET;
    void _g;
    a.send({ t: 'createRoom', settings: old });
    await until(() => a.room?.settings.gameMode === 'texas-holdem');
    a.send({ t: 'createRoom', settings: { ...SET, gameMode: '__proto__' } });
    await wait(100);
    expect(a.room?.settings.gameMode).toBe('texas-holdem');
    closeAll([a]);
  });

  it('BJO-02 大厅里只有房主能切换模式；切换后要重新准备；牌局中不能切换；同一个房间代码', async () => {
    const a = await new Player('阿福').connect();
    const b = await new Player('布丁').connect();
    a.send({ t: 'createRoom', settings: { ...SET, gameMode: 'texas-holdem' } });
    await until(() => !!a.room);
    const code = a.room!.code;
    b.send({ t: 'joinRoom', code });
    await until(() => a.room!.members.length === 2);
    b.send({ t: 'ready', ready: true });
    await until(() => a.room!.members.every((m) => m.ready));
    b.send({ t: 'setMode', gameMode: 'blackjack-21' });
    await until(() => b.errors.some((e) => e.includes('只有房主')));
    a.send({ t: 'setMode', gameMode: 'evil' });
    await until(() => a.errors.some((e) => e.includes('没有这个游戏模式')));
    a.send({ t: 'setMode', gameMode: 'blackjack-21' });
    await until(() => b.room?.settings.gameMode === 'blackjack-21');
    expect([b.room!.code, b.room!.members.find((m) => m.id === b.playerId)!.ready]).toEqual([code, false]);
    b.send({ t: 'ready', ready: true });
    await until(() => a.room!.members.every((m) => m.ready));
    a.send({ t: 'startGame' });
    await until(() => a.bj?.phase === 'betting');
    a.send({ t: 'setMode', gameMode: 'texas-holdem' });
    await until(() => a.errors.some((e) => e.includes('牌局进行中不能切换')));
    closeAll([a, b]);
  });

  it('BJO-03 一名玩家 + 没有 AI 也能开始 21 点（德州仍然至少 2 人）', async () => {
    const { ps } = await table(1);
    expect(ps[0].bj!.players.length).toBe(1);
    closeAll(ps);
    const a = await new Player('阿福').connect();
    a.send({ t: 'createRoom', settings: { ...SET, gameMode: 'texas-holdem' } });
    await until(() => !!a.room);
    a.send({ t: 'startGame' });
    await until(() => a.errors.some((e) => e.includes('至少需要 2')));
    closeAll([a]);
  });
});

describe('同步与裁决', () => {
  for (const n of [2, 3, 4, 5, 6])
    it(`BJO-04 ${n} 名玩家：下注 → 发牌 → 依次行动 → 庄家 → 结果，所有人看到的完全一致`, async () => {
      const { ps, code } = await table(n);
      // 每人 10 + 8（第 5、6 位 10 + 9），庄家 10 + 7：全部赢 1
      const eight = ['8s', '8h', '8d', '8c', '9s', '9h'];
      const ten = ['Ts', 'Th', 'Td', 'Tc', 'Js', 'Jh'];
      await rig(code, ['Kd', ...ten.slice(0, n), '7c', ...eight.slice(0, n)]);
      ps.forEach((p, i) => p.cmd({ type: 'bet', amount: 20 + i * 10 }));
      const order: string[] = [];
      for (let i = 0; i < n; i++) {
        await until(() => ps.every((p) => p.bj!.phase === 'player-turn' && !order.includes(p.bj!.currentPlayerId!)), 8000, '轮到第 ' + i);
        const cur = ps[0].bj!.currentPlayerId!;
        order.push(cur);
        const who = ps.find((p) => p.playerId === cur)!;
        // 只有轮到的人看得到合法动作
        expect(ps.filter((p) => p.bj!.legal).map((p) => p.playerId)).toEqual([cur]);
        who.cmd({ type: 'stand' });
      }
      await until(() => ps.every((p) => p.bj!.phase === 'round-end' || p.bj!.round === 2), 8000, '结束');
      const strip = (v: BlackjackView) => JSON.stringify({ ...v, viewerId: '', legal: null, serverTime: 0 });
      await until(() => new Set(ps.map((p) => strip(p.bj!))).size === 1, 3000, '一致');
      ps.forEach((p, i) => {
        const bet = 20 + i * 10;
        if (p.bj!.phase === 'round-end') expect(p.me!.hands[0].result).toBe('win');
        expect(p.me!.balance).toBe(1000 + bet);
      });
      closeAll(ps);
    }, 30000);

  it('BJO-05 暗牌：翻开之前，任何客户端收到的任何消息里都没有它', async () => {
    const { ps, code } = await table(2);
    await rig(code, ['9d', 'Ts', 'Th', '2c', '8s', '8h', '5c', 'Qd']);
    const mark = ps.map((p) => p.raw.length);
    ps.forEach((p) => p.cmd({ type: 'bet', amount: 20 }));
    await until(() => ps.every((p) => p.bj!.phase === 'player-turn'));
    const hole = srv.rooms.getRoom(code)!.bj!.engine.dealer[1].uid;
    ps.forEach((p, i) => {
      for (const raw of p.raw.slice(mark[i])) expect(raw.includes(`"${hole}"`)).toBe(false);
      expect(p.raw.slice(mark[i]).some((r) => r.includes('"order"') || r.includes('"shoe":{"order"'))).toBe(false);
    });
    closeAll(ps);
  });

  it('BJO-06 客户端不能自称结果：伪造的余额、赔付、胜负、代别人行动全部无效', async () => {
    const { ps, code } = await table(2);
    await rig(code, ['9d', 'Ts', 'Th', '9c', '8s', '9h']);
    const [a, b] = ps;
    a.send({ t: 'bj', cmd: { type: 'bet', amount: 999999 }, actionId: 'h1', round: a.bj!.round });
    await until(() => a.acks('h1').length === 1);
    expect(a.acks('h1')[0]).toMatchObject({ ok: false });
    for (const bad of [{ type: 'bet', amount: -50 }, { type: 'bet', amount: 10.5 }, { type: 'bet', amount: '20' }, { type: 'payout', amount: 500 }, { type: 'win' }, null, 'hit', { type: 'constructor' }]) {
      const id = a.cmd(bad);
      await until(() => a.acks(id).length === 1);
      expect(a.acks(id)[0].ok, JSON.stringify(bad)).toBe(false);
    }
    expect(a.me!.balance).toBe(1000);
    a.cmd({ type: 'bet', amount: 50 });
    b.cmd({ type: 'bet', amount: 50 });
    await until(() => ps.every((p) => p.bj!.phase === 'player-turn'));
    const other = a.bj!.currentPlayerId === a.playerId ? b : a;
    const id = other.cmd({ type: 'hit' });
    await until(() => other.acks(id).length === 1);
    expect(other.acks(id)[0]).toMatchObject({ ok: false, message: '还没轮到你' });
    const d = other.cmd({ type: 'double', balance: 99999, win: true });
    await until(() => other.acks(d).length === 1);
    expect(other.acks(d)[0].ok).toBe(false);
    closeAll(ps);
  });

  it('BJO-07 连点 10 次要牌 / 重复的消息：只发一张牌；同一个 actionId 返回同样的结果', async () => {
    const { ps, code } = await table(1);
    await rig(code, ['9d', '2s', '7c', '3h', '2h', '2d', '2c']);
    const [a] = ps;
    a.cmd({ type: 'bet', amount: 20 });
    await until(() => a.bj!.phase === 'player-turn');
    const { round, token } = a.bj!;
    for (let i = 0; i < 10; i++) a.send({ t: 'bj', cmd: { type: 'hit' }, actionId: 'spam' + i, round, token });
    await until(() => a.msgs.filter((m) => m.t === 'ack' && m.actionId.startsWith('spam')).length === 10);
    const ok = a.msgs.filter((m) => m.t === 'ack' && m.actionId.startsWith('spam') && m.ok);
    expect(ok).toHaveLength(1);
    expect(a.me!.hands[0].cards.length).toBe(3);
    const t2 = a.bj!.token;
    a.send({ t: 'bj', cmd: { type: 'hit' }, actionId: 'same', round, token: t2 });
    a.send({ t: 'bj', cmd: { type: 'hit' }, actionId: 'same', round, token: t2 });
    await until(() => a.acks('same').length === 2);
    expect(a.acks('same').map((m) => [m.ok, !!m.duplicate])).toEqual([[true, false], [true, true]]);
    expect(a.me!.hands[0].cards.length).toBe(4);
    a.send({ t: 'bj', cmd: { type: 'stand' }, actionId: 'stale', round: round - 1, token: a.bj!.token });
    await until(() => a.acks('stale').length === 1);
    expect(a.acks('stale')[0].message).toBe('这一局已经结束');
    closeAll(ps);
  });

  it('BJO-25 不带局号 / 行动令牌、或者是 NaN、字符串、小数的操作：服务器一律拒绝，牌不变', async () => {
    const { ps, code } = await table(1);
    await rig(code, ['9d', '2s', '7c', '3h', '2h']);
    const [a] = ps;
    a.cmd({ type: 'bet', amount: 20 });
    await until(() => a.bj!.phase === 'player-turn');
    const { round } = a.bj!;
    const bad = [{}, { round }, { round, token: 'x' }, { round: 1.5, token: a.bj!.token }, { round: 'r', token: a.bj!.token }, { round: null, token: null }];
    for (const [i, x] of bad.entries()) {
      a.send({ t: 'bj', cmd: { type: 'hit' }, actionId: 'nr' + i, ...x });
      await new Promise((r) => setTimeout(r, 120));
    }
    await until(() => bad.every((_, i) => a.acks('nr' + i).length === 1));
    expect(bad.map((_, i) => a.acks('nr' + i)[0].message)).toEqual(bad.map(() => '无效操作'));
    // 这一局收到的每一份状态里，自己的手牌都没有超过两张（一张也没有多发）
    const mine = a.msgs.flatMap((m) => (m.t === 'bjState' && m.view.round === round ? m.view.players.filter((p) => p.id === a.playerId).flatMap((p) => p.hands.map((h) => h.cards.length)) : []));
    expect(mine.length).toBeGreaterThan(0);
    expect(Math.max(...mine)).toBe(2);
    closeAll(ps);
  });

  it('BJO-08 断线重连：手牌、下注、轮次、余额都恢复，不会重新开局；断线期间庄家照常', async () => {
    const { ps, code } = await table(2);
    await rig(code, ['9d', 'Ts', 'Th', '9c', '8s', '9h']);
    const [a, b] = ps;
    ps.forEach((p) => p.cmd({ type: 'bet', amount: 100 }));
    await until(() => ps.every((p) => p.bj!.phase === 'player-turn'));
    const cur = a.bj!.currentPlayerId === a.playerId ? a : b;
    const before = cur.bj!;
    cur.ws.terminate();
    await wait(40);
    await cur.connect(cur.sessionId);
    await until(() => !!cur.bj && cur.bj.phase !== 'betting');
    expect([cur.bj!.roundId, cur.bj!.round]).toEqual([before.roundId, before.round]);
    expect(cur.me!.hands[0].cards.map((c) => c.uid)).toEqual(before.players.find((p) => p.id === cur.playerId)!.hands[0].cards.map((c) => c.uid));
    expect(cur.me!.balance).toBe(900);
    if (cur.bj!.currentPlayerId === cur.playerId) {
      const id = cur.cmd({ type: 'stand' });
      await until(() => cur.acks(id).length === 1);
      expect(cur.acks(id)[0].ok).toBe(true);
    }
    closeAll(ps);
  });

  it('BJO-09 行动超时自动停牌；没下注的玩家到时跳过；牌局自动继续到下一局', async () => {
    const { ps, code } = await table(2);
    await rig(code, ['9d', 'Ts', '9c', '8s']);
    const [a, b] = ps;
    a.cmd({ type: 'bet', amount: 20 });
    await until(() => a.bj!.phase === 'player-turn', 5000, '倒计时后发牌');
    expect(b.me!.hands.length).toBe(0);
    expect(a.bj!.turnDeadline).not.toBeNull();
    await until(() => a.bj!.events.some((e) => e.type === 'stand' && e.auto) || a.bj!.round === 2, 5000, '自动停牌');
    await until(() => a.bj!.round === 2 && a.bj!.phase === 'betting', 8000, '下一局');
    expect(a.me!.hands.length).toBe(0);
    closeAll(ps);
  }, 20000);

  it('BJO-10 有人中途离开：其他人继续；房主离开会转交；最后一人离开房间被删除', async () => {
    const { ps, code } = await table(3);
    await rig(code, ['9d', 'Ts', 'Th', 'Td', '9c', '8s', '8h', '8d']);
    ps.forEach((p) => p.cmd({ type: 'bet', amount: 20 }));
    await until(() => ps.every((p) => p.bj!.phase === 'player-turn'));
    const host = ps[0];
    host.send({ t: 'leaveRoom' });
    await until(() => ps[1].room!.members.length === 2);
    expect(ps[1].room!.hostId).not.toBe(host.playerId);
    for (let i = 0; i < 2; i++) {
      await until(() => ps[1].bj!.phase !== 'player-turn' || ps.slice(1).some((p) => p.playerId === ps[1].bj!.currentPlayerId));
      ps.slice(1).find((p) => p.playerId === ps[1].bj!.currentPlayerId)?.cmd({ type: 'stand' });
      await wait(120);
    }
    await until(() => ps[1].bj!.round === 2, 8000, '继续到下一局');
    expect(ps[1].bj!.players.length).toBe(2);
    closeAll(ps.slice(1));
    await until(() => !srv.rooms.getRoom(code));
  }, 20000);

  it('BJO-11 房主返回大厅：只能在两局之间；回到同一个房间后可以换回德州并正常开始', async () => {
    const { ps, code } = await table(2);
    const [a, b] = ps;
    ps.forEach((p) => p.cmd({ type: 'bet', amount: 20 }));
    await until(() => a.bj!.phase !== 'betting');
    a.send({ t: 'backToLobby' });
    await until(() => a.errors.some((e) => e.includes('这一局结束后')));
    await until(() => a.bj!.phase === 'betting' && a.bj!.round === 2, 15000, '第二局');
    a.send({ t: 'backToLobby' });
    await until(() => a.room!.status === 'lobby' && b.room!.status === 'lobby');
    expect([a.room!.code, srv.rooms.getRoom(code)!.bj]).toEqual([code, null]);
    a.send({ t: 'setMode', gameMode: 'texas-holdem' });
    await until(() => b.room!.settings.gameMode === 'texas-holdem');
    b.send({ t: 'ready', ready: true });
    await until(() => a.room!.members.every((m) => m.ready));
    a.send({ t: 'startGame' });
    await until(() => a.msgs.some((m) => m.t === 'state') && b.msgs.some((m) => m.t === 'state'));
    closeAll(ps);
  }, 30000);

  it('BJO-12 没有人下注时服务器不空转（不产生任何写入）', async () => {
    const { ps, code } = await table(2);
    const v = (srv.rooms as any).cache.get(code).v;
    await wait(1500);
    expect((srv.rooms as any).cache.get(code).v).toBe(v);
    closeAll(ps);
  });

  it('BJO-13 两台服务器共享同一张 21 点牌桌：跨服务器同步、任意一台都能推进', async () => {
    const hub = new MemoryHub();
    const o = { pace: 0.02, turnTimeMs: 900, lobbyGraceMs: 3000, disconnectGraceMs: 80, backupTickMs: 100, connLimits: { perIp: 1000, perMinute: 10000 } };
    const s1 = await createServer(0, { ...o, store: hub.store('one') });
    const s2 = await createServer(0, { ...o, store: hub.store('two') });
    const a = await new Player('阿福', s1.port).connect();
    const b = await new Player('布丁', s2.port).connect();
    a.send({ t: 'createRoom', settings: SET });
    await until(() => !!a.room);
    b.send({ t: 'joinRoom', code: a.room!.code });
    await until(() => b.room?.members.length === 2);
    b.send({ t: 'ready', ready: true });
    await until(() => a.room!.members.every((m) => m.ready));
    a.send({ t: 'startGame' });
    await until(() => a.bj?.phase === 'betting' && b.bj?.phase === 'betting');
    for (let r = 1; r <= 3; r++) {
      await until(() => [a, b].every((p) => p.bj!.phase === 'betting' && p.bj!.round === r), 10000, '第 ' + r + ' 局');
      a.cmd({ type: 'bet', amount: 20 });
      b.cmd({ type: 'bet', amount: 20 });
      await until(() => a.bj!.round === r + 1 || [a, b].some((p) => p.bj!.phase === 'player-turn' && p.bj!.currentPlayerId === p.playerId), 8000);
      for (let i = 0; i < 12 && a.bj!.round === r; i++) {
        for (const p of [a, b]) if (p.bj!.phase === 'player-turn' && p.bj!.currentPlayerId === p.playerId) p.cmd({ type: 'stand' });
        await wait(60);
      }
      await until(() => a.bj!.round === r + 1 && b.bj!.round === r + 1, 10000, '开下一局');
    }
    const strip = (v: BlackjackView) => JSON.stringify({ ...v, viewerId: '', legal: null, serverTime: 0 });
    await until(() => strip(a.bj!) === strip(b.bj!), 2000, '一致');
    await s1.close();
    await s2.close();
  }, 40000);
});

describe('账号：单人桌使用虚拟筹码', () => {
  const setup = () => {
    const db = openDatabase(':memory:');
    const accounts = new AccountService(db);
    const { userId } = accounts.loginWithIdentity({ provider: 'dev', subject: 'bj', name: '测试' });
    const rooms = new RoomServer({ pace: 0.01, turnTimeMs: 500, disconnectGraceMs: 50, accounts });
    const conn = (uid: string) => {
      const out: { msgs: any[]; bj: BlackjackView | null; room: any; h: any; send: (m: any) => void; cmd: (c: any) => void } = { msgs: [], bj: null, room: null, h: null, send: () => undefined, cmd: () => undefined };
      out.h = rooms.connect({ send: (m) => { const x = JSON.parse(JSON.stringify(m)); out.msgs.push(x); if (x.t === 'room') out.room = x.room; if (x.t === 'bjState') out.bj = x.view.eventsDelta && out.bj ? { ...x.view, events: [...out.bj.events, ...x.view.events] } : x.view; } }, { userId: uid });
      out.send = (m) => out.h.onMessage(JSON.stringify(m));
      out.cmd = (c) => out.send({ t: 'bj', cmd: c, actionId: 'a' + out.msgs.length + Math.random().toString(36).slice(2, 8), round: out.bj?.round, token: out.bj?.token });
      out.send({ t: 'hello', profile: { name: 'x', animal: DEFAULT_ANIMAL } });
      return out;
    };
    const force = async (code: string, kind: any) =>
      (rooms as any).mutate(code, null, (tx: any) => {
        const c = tx.blackjack();
        const st = c.engine.toState();
        c.engine = BlackjackEngine.fromState({ ...st, shoe: forceOutcome(st.shoe, kind, 0, 1) }, seededRandom(1));
        tx.touch();
      });
    return { accounts, userId, rooms, conn, force };
  };
  const SOLO = { opponents: [], startingChips: 1000, smallBlind: 10, bigBlind: 20, blackjack: { dealer: 'fox', tier: 'low' } };

  it('BJO-14 赢 / 输 / 黑杰克：虚拟筹码、经验、统计、成就各结算一次', async () => {
    const { accounts, userId, rooms, conn, force } = setup();
    const a = conn(userId);
    a.send({ t: 'startSolo', settings: SOLO });
    await until(() => a.bj?.phase === 'betting');
    expect([a.bj!.economy, a.bj!.solo, a.bj!.dealer.profile.animal.species]).toEqual(['profile', true, 'fox']);
    const start = accounts.chipsOf(userId);
    expect(a.bj!.players[0].balance).toBe(start);
    const code = a.room.code;
    let expected = start;
    for (const [kind, profit] of [['win', 100], ['loss', -100], ['blackjack', 150], ['push', 0]] as const) {
      await force(code, kind);
      a.cmd({ type: 'bet', amount: 100 });
      await until(() => a.bj!.phase === 'player-turn' || a.bj!.phase === 'round-end');
      if (a.bj!.phase === 'player-turn') a.cmd({ type: 'stand' });
      await until(() => a.bj!.phase === 'round-end');
      expected += profit;
      const s = accounts.getState(userId);
      // 首次黑杰克成就另外奖励 100 筹码
      const bonus = Object.keys(s.achievements).length * 100;
      expect(s.chips, kind).toBe(expected + bonus);
      const r = a.bj!.round;
      a.cmd({ type: 'next' });
      await until(() => a.bj!.round === r + 1 && a.bj!.phase === 'betting');
      expect(a.bj!.players[0].balance).toBe(s.chips);
    }
    const st = accounts.getState(userId);
    expect(st.stats.blackjack).toMatchObject({ rounds: 4, wins: 2, losses: 1, pushes: 1, blackjacks: 1, largestWin: 150, largestBet: 100 });
    expect(st.achievements.bj_first).toBeTruthy();
    expect(st.xp).toBeGreaterThan(0);
    // 重放同一局的结算：不会再发一次
    const key = `${rooms.getRoom(code)!.instanceId}:1:bj:${'x'}`;
    const f = { roundId: 'x', bet: 10, payout: 20, profit: 10, hands: [{ result: 'win' as const, value: 20, cards: 2, doubled: false, fromSplit: false }] };
    expect(accounts.recordBlackjack(userId, key, f, true)).not.toBeNull();
    const after = accounts.chipsOf(userId);
    for (let i = 0; i < 5; i++) expect(accounts.recordBlackjack(userId, key, f, true)).toBeNull();
    expect(accounts.chipsOf(userId)).toBe(after);
    rooms.dispose();
  }, 20000);

  it('BJO-15 一局中途离开：下注按输掉结算；余额永远不会变负', async () => {
    const { accounts, userId, rooms, conn, force } = setup();
    const a = conn(userId);
    a.send({ t: 'startSolo', settings: SOLO });
    await until(() => a.bj?.phase === 'betting');
    await force(a.room.code, 'win');
    a.cmd({ type: 'bet', amount: 200 });
    await until(() => a.bj!.phase === 'player-turn');
    a.send({ t: 'leaveRoom' });
    await until(() => a.room === null);
    expect(accounts.chipsOf(userId)).toBe(800);
    expect(accounts.getState(userId).stats.blackjack).toMatchObject({ rounds: 1, losses: 1 });
    accounts.recordBlackjack(userId, 'big', { roundId: 'z', bet: 99999, payout: 0, profit: -99999, hands: [] }, true);
    expect(accounts.chipsOf(userId)).toBe(0);
    rooms.dispose();
  });

  it('BJO-16 同一账号在两台设备上开两桌：同一笔筹码不能押两次', async () => {
    const { accounts, userId, rooms, conn } = setup();
    const a = conn(userId);
    const b = conn(userId);
    a.send({ t: 'startSolo', settings: { ...SOLO, blackjack: { dealer: 'auto', tier: 'mid' } } });
    b.send({ t: 'startSolo', settings: { ...SOLO, blackjack: { dealer: 'auto', tier: 'mid' } } });
    await until(() => a.bj?.phase === 'betting' && b.bj?.phase === 'betting');
    a.cmd({ type: 'bet', amount: 1000 });
    await until(() => a.bj!.phase !== 'betting');
    // B 的余额在开局时读过：下注前再开一局就会看到被占用
    const r = b.bj!.round;
    b.cmd({ type: 'bet', amount: 1000 });
    await wait(100);
    void r;
    await until(() => a.bj!.phase === 'player-turn' || a.bj!.phase === 'round-end' || a.bj!.phase === 'dealer-turn');
    const held = [a, b].filter((x) => x.bj!.players[0].hands.length || x.bj!.players[0].bet).length;
    expect(held).toBe(1);
    expect(accounts.chipsOf(userId)).toBeGreaterThanOrEqual(0);
    rooms.dispose();
  });

  it('BJO-17 筹码用完：补给到固定数额；还够时拒绝；多人房间的输赢不影响账号筹码', async () => {
    const { accounts, userId, rooms, conn } = setup();
    accounts.recordBlackjack(userId, 'k', { roundId: 'q', bet: 995, payout: 0, profit: -995, hands: [] }, true);
    const a = conn(userId);
    a.send({ t: 'startSolo', settings: SOLO });
    await until(() => a.bj?.phase === 'betting');
    expect(a.bj!.players[0].balance).toBe(5);
    a.cmd({ type: 'rebuy' });
    await until(() => a.bj!.players[0].balance === 500);
    expect(accounts.chipsOf(userId)).toBe(500);
    a.send({ t: 'leaveRoom' });
    await until(() => a.room === null);
    a.bj = null;
    a.send({ t: 'createRoom', settings: SET });
    await until(() => a.room?.status === 'lobby');
    a.send({ t: 'startGame' });
    await until(() => a.bj?.phase === 'betting');
    expect([a.bj!.economy, a.bj!.players[0].balance]).toEqual(['table', 1000]);
    a.cmd({ type: 'bet', amount: 500 });
    await until(() => a.bj!.phase === 'player-turn' || a.bj!.round === 2);
    if (a.bj!.phase === 'player-turn') a.cmd({ type: 'stand' });
    await until(() => a.bj!.round === 2, 8000);
    // 牌桌输赢（±500 / +750）不入账；随机发到黑杰克时只有成就奖励
    const st = accounts.getState(userId);
    expect(accounts.chipsOf(userId)).toBe(500 + Object.keys(st.achievements).length * REWARD.chips.achievement);
    expect(st.stats.blackjack.rounds).toBe(2);
    rooms.dispose();
  }, 20000);

  it('BJO-18 数据库从旧版本升级：旧玩家的统计保留，21 点统计从 0 开始', () => {
    const db = openDatabase(':memory:');
    const acc = new AccountService(db);
    const { userId } = acc.loginWithIdentity({ provider: 'dev', subject: 'old' });
    db.exec("UPDATE player_statistics SET blackjack = 'not json', hands_played = 7");
    expect(acc.getState(userId).stats).toMatchObject({ handsPlayed: 7, blackjack: { rounds: 0, wins: 0 } });
    expect((db.prepare('SELECT version FROM schema_meta').get() as any).version).toBe(2);
  });
});

describe('统计、成就、存档', () => {
  const play = (s: Stats, ...fs: any[]) => fs.reduce((acc, f, i) => applyBlackjackRound(acc, { roundId: 'r' + i, ...f }).stats, s);
  const hand = (result: string, x: object = {}) => ({ result, value: 20, cards: 2, doubled: false, fromSplit: false, ...x });
  const base = () => normalizeStats(EMPTY_STATS);

  it('BJO-19 胜负按整局净值；加倍、分牌、爆牌、黑杰克、最大赢取分别统计；原来的统计不受影响', () => {
    const s = play(
      { ...base(), handsPlayed: 9 },
      { bet: 100, payout: 250, profit: 150, hands: [hand('blackjack', { value: 21 })] },
      { bet: 200, payout: 400, profit: 200, hands: [hand('win', { doubled: true, value: 21, cards: 3 })] },
      { bet: 200, payout: 200, profit: 0, hands: [hand('win', { fromSplit: true }), hand('bust', { fromSplit: true })] },
      { bet: 50, payout: 0, profit: -50, hands: [hand('lose')] },
      { bet: 50, payout: 0, profit: -50, hands: [hand('forfeit')] },
    );
    expect(s.blackjack).toMatchObject({ rounds: 5, wins: 2, losses: 2, pushes: 1, blackjacks: 1, busts: 1, doubleDowns: 1, splits: 1, doubleWins: 1, wins21: 1, largestWin: 200, largestBet: 200, totalBet: 600, totalPayout: 850 });
    expect(s.handsPlayed).toBe(9);
    expect(EMPTY_STATS.blackjack.rounds).toBe(0);
  });
  it('BJO-20 成就：黑杰克、加倍成功、刚好 21、连输三局后赢回、累计 10 胜', () => {
    const lose = { bet: 10, payout: 0, profit: -10, hands: [hand('lose')] };
    const win = { bet: 10, payout: 20, profit: 10, hands: [hand('win')] };
    const s = play(base(), lose, lose, lose, win);
    expect(newAchievements(s, {})).toEqual(expect.arrayContaining(['bj_comeback']));
    expect(newAchievements(play(base(), lose, lose, win), {})).not.toContain('bj_comeback');
    expect(newAchievements(play(base(), ...Array(10).fill(win)), {})).toContain('bj_win10');
    expect(newAchievements(play(base(), { bet: 10, payout: 25, profit: 15, hands: [hand('blackjack')] }), {})).toContain('bj_first');
    expect(newAchievements(play(base(), { bet: 20, payout: 40, profit: 20, hands: [hand('win', { doubled: true, value: 21, cards: 3 })] }), {})).toEqual(expect.arrayContaining(['bj_double', 'bj_exact']));
  });
  it('BJO-21 结算闸门：重连时已经结束的局不再发；同一局只发一次；下一局照常', () => {
    const gate = new BlackjackGate();
    expect(gate.due({ roundId: 'a', phase: 'round-end' })).toBe(false); // 刷新后第一眼就已结束
    expect(gate.due({ roundId: 'a', phase: 'round-end' })).toBe(false);
    expect(gate.due({ roundId: 'b', phase: 'betting' })).toBe(false);
    expect(gate.due({ roundId: 'b', phase: 'round-end' })).toBe(true);
    expect(gate.due({ roundId: 'b', phase: 'round-end' })).toBe(false);
    gate.reset();
    expect(gate.due({ roundId: 'c', phase: 'player-turn' })).toBe(false);
    expect(gate.due({ roundId: 'c', phase: 'round-end' })).toBe(true);
  });
  it('BJO-22 损坏 / 缺失的统计补 0；游客合并进账号时封顶并保持一致', () => {
    expect(normalizeBlackjack({ rounds: -3, wins: 'x', busts: 2.9, evil: 1 })).toMatchObject({ rounds: 0, wins: 0, busts: 2 });
    expect(normalizeStats({ handsPlayed: 3 }).blackjack.rounds).toBe(0);
    const m = mergeGuestBlackjack(normalizeBlackjack({ rounds: 5, wins: 2, largestWin: 10 }), normalizeBlackjack({ rounds: 1e9, wins: 1e9, losses: 1e9, blackjacks: 1e12, largestWin: 1e15 }), { rounds: 100, chips: 1000 });
    expect(m.rounds).toBe(105);
    expect(m.wins + m.losses + m.pushes).toBeLessThanOrEqual(m.rounds);
    expect([m.blackjacks, m.largestWin]).toEqual([400, 1000]);
  });
  it('BJO-23 本地单人：下注用持久金币；赢输各结算一次；中途离开按输结算；重复结算无效；补给只在不够时生效', async () => {
    const { startLocalBlackjack, blackjackCommand, stopLocalBlackjack } = await import('../src/net/localBlackjack');
    const { useProfile } = await import('../src/store/profileStore');
    const { useGame } = await import('../src/store/gameStore');
    useProfile.getState().resetAll();
    useProfile.setState({ chips: 1000 });
    startLocalBlackjack({ dealer: 'cat', tier: 'low', companions: [] });
    const v = () => useGame.getState().bj!;
    await until(() => v().phase === 'betting');
    expect([v().economy, v().players[0].balance, useGame.getState().view]).toEqual(['profile', 1000, null]);
    expect(blackjackCommand({ type: 'bet', amount: 100 }, { round: 1, token: v().token })).toBeNull();
    await until(() => v().phase === 'player-turn' || v().phase === 'round-end', 10000);
    const bet = 100;
    if (v().phase === 'player-turn') {
      stopLocalBlackjack();
      expect(useProfile.getState().chips).toBe(1000 - bet);
      expect(useProfile.getState().stats.blackjack).toMatchObject({ rounds: 1, losses: 1 });
      stopLocalBlackjack();
      expect(useProfile.getState().chips).toBe(1000 - bet);
    } else stopLocalBlackjack();
    const chips = useProfile.getState().chips;
    const st = useProfile.getState();
    expect(st.settleBlackjack('dup', 10, st.stats, 50)).not.toBeNull();
    expect(st.settleBlackjack('dup', 10, st.stats, 50)).toBeNull();
    expect(useProfile.getState().chips).toBe(chips + 50);
    expect(useProfile.getState().refillChips(10)).toBe(chips + 50);
    useProfile.setState({ chips: 3 });
    expect(useProfile.getState().refillChips(10)).toBe(500);
    const { buildSave, parseSave } = await import('../src/save/saveFile');
    useProfile.setState({ chips: 777 });
    const save = parseSave(JSON.stringify(buildSave()));
    expect([save.profile.chips, save.profile.stats.blackjack.rounds]).toEqual([777, useProfile.getState().stats.blackjack.rounds]);
    const old = JSON.parse(JSON.stringify(buildSave()));
    delete old.profile.chips;
    delete old.profile.stats.blackjack;
    expect([parseSave(JSON.stringify(old)).profile.chips, parseSave(JSON.stringify(old)).profile.stats.blackjack.rounds]).toEqual([1000, 0]);
  }, 20000);
  it('BJO-24 结算事实只来自服务器视图；结构不对的 21 点消息被客户端丢弃', () => {
    expect(parseServerMessage(JSON.stringify({ t: 'bjState', view: { kind: 'blackjack', round: 1 } }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: 'bjState', view: null }))).toBeNull();
    expect(factsFromView({ viewerId: 'a', phase: 'player-turn', players: [] } as any)).toBeNull();
  });
});
