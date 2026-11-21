// 多台服务器共享房间（模拟 Vercel 上的多个函数实例）：
// 玩家 A 连到实例 1，玩家 B 连到实例 2，必须进入同一个房间并实时同步；实例 1 下线后游戏在实例 2 上继续。
import { describe, it, expect, afterAll } from 'vitest';
import WebSocket from 'ws';
import RedisMock from 'ioredis-mock';
import { createServer } from '../server/index';
import { MemoryHub, type SharedStore } from '../server/store';
import { createRedisStore } from '../server/redisStore';
import type { ServerMessage, RoomInfo } from '../src/core/protocol';
import type { TableView } from '../src/core/game/view';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';

async function until(cond: () => boolean, ms = 8000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

class Player {
  ws!: WebSocket;
  msgs: ServerMessage[] = [];
  sessionId = '';
  playerId = '';
  resumed: boolean | undefined;
  room: RoomInfo | null = null;
  view: TableView | null = null;
  errors: string[] = [];
  constructor(public name: string) {}
  async connect(port: number, sessionId?: string, path = '/api/ws') {
    this.ws = new WebSocket(`ws://localhost:${port}${path}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      if (m.t === 'welcome') {
        this.sessionId = m.sessionId;
        this.playerId = m.playerId;
        this.resumed = m.resumed;
      }
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'state') {
        const prev = this.view;
        this.view =
          m.view.eventsDelta && prev && prev.handNumber === m.view.handNumber
            ? {
                ...m.view,
                events: [...prev.events, ...m.view.events.filter((e) => e.seq > (prev.events.at(-1)?.seq ?? 0))],
                players: m.view.players.map((p) => (p.profile ? p : { ...p, profile: prev.players.find((x) => x.id === p.id)!.profile })),
              }
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
  }
  send(m: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  close() {
    this.ws.close();
  }
}

const servers: Awaited<ReturnType<typeof createServer>>[] = [];
afterAll(async () => {
  for (const s of servers) await s.close().catch(() => {});
});

async function cluster(makeStore: (i: number) => SharedStore) {
  const opts = { pace: 0.02, turnTimeMs: 800, lobbyGraceMs: 4000, disconnectGraceMs: 300, backupTickMs: 200, connLimits: { perIp: 1000, perMinute: 10000 } };
  const s1 = await createServer(0, { ...opts, store: makeStore(1) });
  const s2 = await createServer(0, { ...opts, store: makeStore(2) });
  servers.push(s1, s2);
  return [s1, s2] as const;
}

/** 两人分别连到两台服务器：建房 → 加入 → 互相看到 → 开始 → 打几手 */
async function playAcross(p1: number, p2: number) {
  const a = new Player('Tomato');
  const b = new Player('Alex');
  await a.connect(p1);
  await b.connect(p2);
  a.send({ t: 'createRoom', settings: { maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
  await until(() => !!a.room);
  const code = a.room!.code;
  b.send({ t: 'joinRoom', code });
  // A（实例 1）实时看到 B 加入；B（实例 2）看到 A
  await until(() => a.room!.members.length === 2 && !!b.room && b.room.members.length === 2);
  expect(a.room!.members.map((m) => m.profile.name).sort()).toEqual(['Alex', 'Tomato']);
  expect(b.room!.code).toBe(code);
  expect(b.room!.hostId).toBe(a.playerId);

  // 非房主不能开始
  b.send({ t: 'startGame' });
  await until(() => b.errors.some((e) => e.includes('只有房主')));
  b.send({ t: 'ready', ready: true });
  await until(() => a.room!.members.every((m) => m.ready));
  a.send({ t: 'startGame' });
  await until(() => !!a.view && !!b.view && a.view.handNumber >= 1 && b.view.handNumber >= 1);
  // 双方都只看到自己的底牌
  for (const p of [a, b]) {
    for (const seat of p.view!.players) {
      if (seat.id === p.playerId) expect(seat.hole.every((c) => c !== null)).toBe(true);
      else expect(seat.hole.every((c) => c === null)).toBe(true);
    }
  }
  // 两人轮流跟注 / 过牌，打到第 3 手
  const iv = setInterval(() => {
    for (const p of [a, b]) {
      const v = p.view;
      if (v?.legal && v.currentPlayerId === p.playerId) p.send({ t: 'action', action: { type: v.legal.canCheck ? 'check' : 'call' }, actionId: `x${v.handNumber}_${v.events.length}`, hand: v.handNumber });
    }
  }, 25);
  await until(() => a.view!.handNumber >= 3 || !!a.view!.gameOver, 20000);
  clearInterval(iv);
  // 双方看到的状态一致，筹码守恒
  await until(() => a.view!.handNumber === b.view!.handNumber && a.view!.potTotal === b.view!.potTotal);
  const total = (v: TableView) => v.players.reduce((s, p) => s + p.chips + (v.phase !== 'complete' && v.phase !== 'idle' ? p.totalBet : 0), 0);
  expect(total(a.view!)).toBe(2000);
  expect(total(b.view!)).toBe(2000);
  return { a, b, code };
}

describe('多台服务器共享房间（内存共享存储）', () => {
  it('A 在实例 1、B 在实例 2：建房、加入、互相看到、开始游戏、同步牌局', { timeout: 40000 }, async () => {
    const hub = new MemoryHub();
    const [s1, s2] = await cluster((i) => hub.store('inst' + i));
    const { a, b } = await playAcross(s1.port, s2.port);
    a.close();
    b.close();
  });

  it('实例 1 下线：玩家重连到实例 2，回到原来的座位，牌局继续', { timeout: 40000 }, async () => {
    const hub = new MemoryHub();
    const [s1, s2] = await cluster((i) => hub.store('inst' + i));
    const { a, b, code } = await playAcross(s1.port, s2.port);
    const hand = a.view!.handNumber;
    const aSession = a.sessionId;
    const aId = a.playerId;
    // 实例 1 整个下线（模拟 Vercel 回收函数实例）
    await s1.close();
    // A 用原来的会话连到实例 2
    const a2 = new Player('Tomato');
    await a2.connect(s2.port, aSession);
    expect(a2.resumed).toBe(true);
    expect(a2.playerId).toBe(aId);
    await until(() => a2.room?.code === code && !!a2.view);
    expect(a2.view!.players.find((p) => p.id === aId)!.hole.every((c) => c !== null)).toBe(true);
    // 牌局继续推进（计时由实例 2 接手）
    const iv = setInterval(() => {
      for (const p of [a2, b]) {
        const v = p.view;
        if (v?.legal && v.currentPlayerId === p.playerId) p.send({ t: 'action', action: { type: v.legal.canCheck ? 'check' : 'call' } });
      }
    }, 25);
    await until(() => (b.view!.handNumber > hand + 1 && a2.view!.handNumber > hand + 1) || !!b.view!.gameOver, 20000);
    clearInterval(iv);
    a2.close();
    b.close();
  });

  it('离开与重新加入：另一台服务器上的玩家立即看到', { timeout: 20000 }, async () => {
    const hub = new MemoryHub();
    const [s1, s2] = await cluster((i) => hub.store('inst' + i));
    const a = new Player('Tomato');
    const b = new Player('Alex');
    await a.connect(s1.port);
    await b.connect(s2.port);
    a.send({ t: 'createRoom', settings: { maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => !!a.room);
    const code = a.room!.code;
    b.send({ t: 'joinRoom', code });
    b.send({ t: 'joinRoom', code }); // 重复加入不会出现两个 Alex
    await until(() => a.room!.members.length === 2);
    await new Promise((r) => setTimeout(r, 100));
    expect(a.room!.members.filter((m) => m.profile.name === 'Alex')).toHaveLength(1);
    a.send({ t: 'leaveRoom' });
    await until(() => b.room!.members.length === 1 && b.room!.hostId === b.playerId);
    expect(b.msgs.some((m) => m.t === 'chat' && m.message.text.includes('Tomato 离开了房间'))).toBe(true);
    a.send({ t: 'joinRoom', code });
    await until(() => b.room!.members.length === 2 && a.room?.members.length === 2);
    // 断线：另一台服务器上的玩家看到“连接中断”，重连后恢复
    const aSid = a.sessionId;
    a.close();
    await until(() => b.room!.members.some((m) => m.profile.name === 'Tomato' && !m.connected));
    const a2 = new Player('Tomato');
    await a2.connect(s2.port, aSid);
    await until(() => b.room!.members.every((m) => m.connected));
    a2.close();
    b.close();
  });

  it('换连接（平台连接时限到期前）：同一会话连到另一台服务器，不会被标记为断线', { timeout: 20000 }, async () => {
    const hub = new MemoryHub();
    const [s1, s2] = await cluster((i) => hub.store('inst' + i));
    const a = new Player('Tomato');
    const b = new Player('Alex');
    await a.connect(s1.port);
    await b.connect(s2.port);
    a.send({ t: 'createRoom', settings: { maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => !!a.room);
    b.send({ t: 'joinRoom', code: a.room!.code });
    await until(() => a.room!.members.length === 2);
    // 先连上新连接（实例 2），再关闭旧连接（实例 1）
    const a2 = new Player('Tomato');
    a2.ws = undefined as any;
    const sid = a.sessionId;
    await (async () => {
      a2.ws = new WebSocket(`ws://localhost:${s2.port}/api/ws`);
      a2.ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as ServerMessage;
        a2.msgs.push(m);
        if (m.t === 'welcome') a2.playerId = m.playerId;
        if (m.t === 'room') a2.room = m.room;
      });
      await new Promise<void>((r) => a2.ws.on('open', () => r()));
      a2.send({ t: 'hello', sessionId: sid, profile: { name: 'Tomato', animal: DEFAULT_ANIMAL }, rotate: true });
      await until(() => !!a2.room);
    })();
    a.close();
    await new Promise((r) => setTimeout(r, 800));
    expect(b.room!.members.every((m) => m.connected)).toBe(true);
    expect(b.msgs.some((m) => m.t === 'chat' && m.message.text.includes('断线了'))).toBe(false);
    a2.close();
    b.close();
  });
});

describe('Redis 共享存储（与 Vercel 上的 Upstash Redis 使用同一套代码）', () => {
  it('两台服务器通过 Redis 共享房间与牌局', { timeout: 40000 }, async () => {
    const opts = { host: 'redis-mock-' + Math.random().toString(36).slice(2), port: 6379 };
    const [s1, s2] = await cluster((i) => createRedisStore('redis-inst' + i, () => new RedisMock(opts) as any));
    const { a, b } = await playAcross(s1.port, s2.port);
    a.close();
    b.close();
  });
});

import { redisUrlFromEnv } from '../server/redisStore';

describe('Redis 地址（Vercel 应用市场集成的环境变量）', () => {
  it('支持 REDIS_URL / KV_URL，以及只有 Upstash REST 地址和令牌的情况', () => {
    expect(redisUrlFromEnv({ REDIS_URL: 'rediss://a' })).toBe('rediss://a');
    expect(redisUrlFromEnv({ KV_URL: 'rediss://b' })).toBe('rediss://b');
    expect(redisUrlFromEnv({ KV_REST_API_URL: 'https://fun-cat-123.upstash.io', KV_REST_API_TOKEN: 'tok/en' })).toBe('rediss://default:tok%2Fen@fun-cat-123.upstash.io:6379');
    expect(redisUrlFromEnv({})).toBeNull();
  });
});
