// 全项目深度检查回归：每一项都对应一个在旧代码上真实存在的问题
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import net0 from 'node:net';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import { RoomServer } from '../server/rooms';
import { MemoryHub, type SharedStore } from '../server/store';
import { categoryOf } from '../server/rateLimit';
import { PokerEngine } from '../src/core/table/engine';
import { GameController } from '../src/core/game/controller';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import { seededRandom } from '../src/core/utils/random';

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
async function until(cond: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('等待超时');
    await wait(10);
  }
}
const SET = { maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 };
const profile = (name: string) => ({ name, animal: DEFAULT_ANIMAL, level: 1 });

class Conn {
  msgs: any[] = [];
  room: any = null;
  playerId = '';
  sessionId = '';
  h: ReturnType<RoomServer['connect']>;
  constructor(srv: RoomServer, public name: string) {
    this.h = srv.connect({
      send: (m) => {
        this.msgs.push(JSON.parse(JSON.stringify(m)));
        if (m.t === 'welcome') (this.playerId = m.playerId), (this.sessionId = m.sessionId);
        if (m.t === 'room') this.room = m.room;
      },
    });
  }
  send(m: any) {
    this.h.onMessage(JSON.stringify(m));
  }
  async hello(sessionId?: string) {
    this.playerId = '';
    this.send({ t: 'hello', sessionId, profile: profile(this.name) });
    await until(() => !!this.playerId);
    return this;
  }
  async create(s = SET) {
    this.send({ t: 'createRoom', settings: s });
    await until(() => !!this.room);
    return this.room.code as string;
  }
  errors() {
    return this.msgs.filter((m) => m.t === 'error').map((m) => m.message as string);
  }
}

describe('牌局引擎', () => {
  it('DC-01 单挑：大盲筹码不足、全押金额比小盲还少时直接摊牌，不要求小盲再跟（超时不会白白弃牌）', () => {
    for (let seed = 1; seed < 30; seed++) {
      const e = new PokerEngine({ smallBlind: 10, bigBlind: 20, rng: seededRandom(seed) });
      e.addPlayer('a', 'A', 1000);
      e.addPlayer('b', 'B', 5);
      e.startHand();
      if (e.bbSeat !== e.getPlayer('b')!.seat) {
        // 庄家 / 小盲是 B：A 是大盲，B 全押 5
        expect(e.pendingAdvance).toBe(true);
        continue;
      }
      expect(e.currentPlayer).toBeNull();
      expect(e.pendingAdvance).toBe(true);
      for (let i = 0; i < 6 && e.isHandActive(); i++) e.advance();
      expect(e.phase).toBe('complete');
      expect(e.players.reduce((s, p) => s + p.chips, 0)).toBe(1005);
      // 最多只可能输 5
      expect(e.getPlayer('a')!.chips).toBeGreaterThanOrEqual(995);
    }
  });

  it('DC-02 大盲全押金额比小盲多时，小盲仍然需要决定跟不跟', () => {
    const e = new PokerEngine({ smallBlind: 10, bigBlind: 20, rng: seededRandom(3) });
    e.addPlayer('a', 'A', 1000);
    e.addPlayer('b', 'B', 15);
    e.startHand();
    expect(e.currentPlayer?.id).toBe('a');
  });
});

describe('控制器', () => {
  const ctrl = (ids: string[], chips: number[]) =>
    new GameController(ids.map((id, i) => ({ id, profile: profile(id), chips: chips[i], isAI: false })), { smallBlind: 10, bigBlind: 20, turnTimeMs: 30000, offlineTurnMs: 6000, autoRun: false });

  it('DC-03 断线 / 重连反复几次不能延长自己的行动时间', () => {
    const c = ctrl(['a', 'b'], [1000, 1000]);
    c.start();
    c.tick(Date.now() + 5000);
    const cur = c.engine.currentPlayer!.id;
    vi.useFakeTimers({ now: Date.now() });
    try {
      c.setConnected(cur, false);
      const first = c.getView(cur).turnDeadline!;
      for (let i = 0; i < 5; i++) {
        vi.setSystemTime(Date.now() + 1000);
        c.setConnected(cur, true);
        c.setConnected(cur, false);
      }
      expect(c.getView(cur).turnDeadline!).toBeLessThanOrEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('DC-04 别的玩家离开不会让正在行动的人重新计时', () => {
    const c = ctrl(['a', 'b', 'c', 'd'], [1000, 1000, 1000, 1000]);
    c.start();
    c.tick(Date.now() + 5000);
    const cur = c.engine.currentPlayer!.id;
    const before = c.getView(cur).turnDeadline!;
    const other = c.engine.players.find((p) => p.id !== cur && !p.folded)!.id;
    vi.useFakeTimers({ now: Date.now() + 8000 });
    try {
      c.removePlayer(other);
      expect(c.engine.currentPlayer!.id).toBe(cur);
      expect(c.getView(cur).turnDeadline).toBe(before);
      expect(c.nextWakeAt()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('DC-05 同一手多人出局：这一手开始时筹码更多的人名次更高', () => {
    let checked = 0;
    for (let seed = 1; seed < 400 && checked < 3; seed++) {
      const c = new GameController(
        // 座位靠前的筹码更多：旧代码按座位顺序记录出局，会把他排到更低的名次
        [['big', 400], ['small', 200], ['boss', 5000]].map(([id, chips]) => ({ id: id as string, profile: profile(id as string), chips: chips as number, isAI: false })),
        { smallBlind: 10, bigBlind: 20, autoRun: false, pace: 0, rng: seededRandom(seed) },
      );
      c.start();
      let t = Date.now() + 1000;
      c.tick(t);
      for (let i = 0; i < 40 && c.engine.handNumber === 1 && !c.isGameOver(); i++) {
        const cur = c.engine.currentPlayer;
        const legal = cur && c.engine.getLegalActions(cur.id);
        if (cur && legal) c.handleAction(cur.id, legal.canAllIn ? { type: 'allin' } : legal.canCall ? { type: 'call' } : { type: 'check' });
        else c.tick((t += 100000));
      }
      if (c.engine.getPlayer('boss')!.chips !== 5600) continue;
      for (let i = 0; i < 10 && !c.isGameOver(); i++) c.tick((t += 100000));
      expect(c.getView('boss').gameOver!.rankings.map((r) => r.playerId)).toEqual(['boss', 'big', 'small']);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('房间服务器', () => {
  const make = (o = {}) => new RoomServer({ pace: 0.02, turnTimeMs: 600, lobbyGraceMs: 400, disconnectGraceMs: 50, ...o });

  it('DC-06 同一条连接换了会话：旧会话按断线处理，不会一直占着座位', async () => {
    const srv = make();
    const a = await new Conn(srv, '阿福').hello();
    const b = await new Conn(srv, '布丁').hello();
    const code = await a.create();
    b.send({ t: 'joinRoom', code });
    await until(() => b.room?.members.length === 2);
    const oldId = b.playerId;
    await b.hello('zzzzzzzzzzzz');
    expect(b.playerId).not.toBe(oldId);
    await until(() => !srv.getRoom(code)!.members.some((m) => m.id === oldId && m.connected), 2000);
    srv.dispose();
  });

  it('DC-07 想加入的房间已满：留在原来的房间，不会丢掉座位', async () => {
    const srv = make();
    const a = await new Conn(srv, '阿福').hello();
    const b = await new Conn(srv, '布丁').hello();
    const code = await a.create({ ...SET, maxPlayers: 2 });
    a.send({ t: 'addAI', personality: 'smartCat', difficulty: 'easy' });
    await until(() => a.room.members.length === 2);
    const mine = await b.create();
    b.send({ t: 'joinRoom', code });
    await until(() => b.errors().some((e) => e.includes('房间已满')));
    await wait(50);
    expect(b.room?.code).toBe(mine);
    expect(srv.getRoom(mine)?.members.length).toBe(1);
    srv.dispose();
  });

  it('DC-08 比赛结束后房主一直不在线：房主交给在线玩家，可以回到房间大厅', async () => {
    const srv = make();
    const a = await new Conn(srv, '阿福').hello();
    const b = await new Conn(srv, '布丁').hello();
    const code = await a.create();
    b.send({ t: 'joinRoom', code });
    await until(() => b.room?.members.length === 2);
    b.send({ t: 'ready', ready: true });
    await until(() => a.room.members.every((m: any) => m.ready));
    a.send({ t: 'startGame' });
    await until(() => b.room?.status === 'playing');
    a.h.onClose();
    srv.getRoom(code)!.status = 'finished';
    (srv as any).store.commitRoom && (await (srv as any).mutate(code, null, (tx: any) => ((tx.room.status = 'finished'), (tx.room.game = null), tx.touch())));
    await until(() => b.room?.hostId === b.playerId, 4000);
    b.send({ t: 'backToLobby' });
    await until(() => b.room?.status === 'lobby');
    srv.dispose();
  });

  it('DC-09 最后一名在线玩家离开、剩下的都断线：房间会开始计算空置时间并被清理', async () => {
    const srv = make({ lobbyGraceMs: 60000, emptyRoomMs: 300 });
    (srv as any).sweepTimer && clearInterval((srv as any).sweepTimer);
    const a = await new Conn(srv, '阿福').hello();
    const b = await new Conn(srv, '布丁').hello();
    const code = await a.create();
    b.send({ t: 'joinRoom', code });
    await until(() => b.room?.members.length === 2);
    b.h.onClose();
    await until(() => srv.getRoom(code)!.members.some((m) => !m.connected));
    a.send({ t: 'leaveRoom' });
    await until(() => srv.getRoom(code)?.members.length === 1);
    await wait(400);
    (srv as any).sweep();
    await until(() => !srv.getRoom(code), 1000);
    srv.dispose();
  });

  it('DC-10 共享存储短暂出错：牌局计时稍后重试，不会永远停住', async () => {
    const hub = new MemoryHub().store('x');
    let fail = false;
    let failed = 0;
    const store: SharedStore = { ...hub, commitRoom: async (...x) => { if (fail) { failed++; throw new Error('存储暂时不可用'); } return hub.commitRoom(...x); } };
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const srv = make({ store });
    const a = await new Conn(srv, '阿福').hello();
    const code = await a.create();
    a.send({ t: 'addAI', personality: 'smartCat', difficulty: 'easy' });
    await until(() => a.room.members.length === 2);
    fail = false;
    a.send({ t: 'startGame' });
    await until(() => a.room.status === 'playing');
    fail = true;
    await until(() => failed > 0);
    await wait(100);
    const hand = srv.getRoom(code)!.game!.engine.handNumber;
    const v = (srv as any).cache.get(code).v;
    fail = false;
    await until(() => (srv as any).cache.get(code)?.v > v, 4000);
    expect(hand).toBeGreaterThanOrEqual(0);
    err.mockRestore();
    srv.dispose();
  });

  it('DC-11 订阅重新连上：错过的更新会补发给本机玩家', async () => {
    const hub = new MemoryHub();
    let deaf = false;
    let onRe: () => void = () => undefined;
    const s1 = hub.store('one');
    const s2raw = hub.store('two');
    const s2: SharedStore = { ...s2raw, subscribe: (fn) => s2raw.subscribe((e) => !deaf && fn(e)), onReconnect: (fn) => (onRe = fn) };
    const A = make({ store: s1 });
    const B = make({ store: s2 });
    const a = await new Conn(A, '阿福').hello();
    const b = await new Conn(B, '布丁').hello();
    const code = await a.create();
    b.send({ t: 'joinRoom', code });
    await until(() => b.room?.members.length === 2);
    deaf = true;
    a.send({ t: 'addAI', personality: 'smartCat', difficulty: 'easy' });
    await until(() => a.room.members.length === 3);
    await wait(50);
    expect(b.room.members.length).toBe(2);
    deaf = false;
    onRe();
    await until(() => b.room.members.length === 3, 2000);
    A.dispose();
    B.dispose();
  });

  it('DC-12 “离开房间”不受建房限流影响（否则会回到首页却仍占着座位）', () => {
    expect(categoryOf('leaveRoom')).not.toBe('room');
    expect(categoryOf('createRoom')).toBe('room');
  });
});

describe('服务器不会被坏请求弄崩', () => {
  const crash = async (run: (port: number) => Promise<void>, o = {}) => {
    const srv = await createServer(0, o);
    const errors: unknown[] = [];
    const on = (e: unknown) => void errors.push(e);
    // vitest 自己也监听 uncaughtException：测试期间换成我们的
    const old = process.listeners('uncaughtException');
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', on);
    try {
      await run(srv.port);
      await wait(200);
    } finally {
      process.removeListener('uncaughtException', on);
      for (const l of old) process.on('uncaughtException', l as any);
    }
    const ok = (await fetch(`http://127.0.0.1:${srv.port}/health`)).ok;
    await srv.close();
    return { errors, ok };
  };

  it('DC-13 升级请求的网址格式错误（“//”）：只拒绝这一条连接', async () => {
    const r = await crash(async (port) => {
      const s = net0.connect(port, '127.0.0.1');
      s.on('error', () => undefined);
      s.write('GET // HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
      await wait(200);
      s.destroy();
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('DC-14 被拒绝的连接在关闭前发来坏数据：不会崩溃', async () => {
    const r = await crash(
      async (port) => {
        const s = net0.connect(port, '127.0.0.1');
        s.on('error', () => undefined);
        s.write('GET /api/ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
        await wait(100);
        s.write(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
        await wait(100);
        s.destroy();
      },
      { connLimits: { perIp: 0, perMinute: 1000 } },
    );
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('联机客户端', () => {
  let srv: Awaited<ReturnType<typeof createServer>>;
  let net: typeof import('../src/net/netClient').net;
  let session: typeof import('../src/net/session').session;
  let useGame: typeof import('../src/store/gameStore').useGame;
  beforeAll(async () => {
    srv = await createServer(0, { pace: 0.02, turnTimeMs: 600, lobbyGraceMs: 5000, connLimits: { perIp: 1000, perMinute: 10000 } });
    g.location = { protocol: 'http:', host: `127.0.0.1:${srv.port}`, hostname: '127.0.0.1', origin: `http://127.0.0.1:${srv.port}` };
    ({ net } = await import('../src/net/netClient'));
    ({ session } = await import('../src/net/session'));
    ({ useGame } = await import('../src/store/gameStore'));
  });
  afterAll(async () => {
    net.disconnect();
    await srv.close();
  });

  it('DC-15 断线时离开房间、马上创建新房间：重新连上后留在新房间里，不会被迟到的“离开”踢出去', async () => {
    useGame.getState().setScreen('online');
    net.createRoom(SET as any);
    await until(() => !!useGame.getState().room);
    const old = useGame.getState().room!.code;
    // 连接突然断开（浏览器还没察觉），离开消息没有送到
    const ws = (net as any).ws as WebSocket;
    const onclose = (ws as any).onclose;
    (ws as any).send = () => undefined;
    session.leave('online');
    (ws as any).onclose = onclose;
    ws.close();
    await until(() => (net as any).ws !== ws);
    net.createRoom(SET as any);
    await until(() => !!useGame.getState().room, 6000);
    const fresh = useGame.getState().room!.code;
    expect(fresh).not.toBe(old);
    await wait(500);
    expect(useGame.getState().room?.code).toBe(fresh);
    expect(srv.rooms.getRoom(fresh)?.members.length).toBe(1);
    session.leave('home');
    await until(() => !(net as any).ws);
  }, 20000);

  it('DC-16 服务器对局超时、已改打离线对局：之后连上也不会被拉进服务器的牌桌', async () => {
    useGame.getState().setScreen('quick');
    // 服务器迟迟连不上：请求一直在队列里
    const connect = net.connect;
    (net as any).connect = () => undefined;
    const ok = await net.startSolo({ opponents: [{ personality: 'smartCat', difficulty: 'easy' }], startingChips: 1000, smallBlind: 10, bigBlind: 20 }, 200);
    expect(ok).toBe(false);
    (net as any).connect = connect;
    useGame.getState().set({ mode: 'local' });
    net.connect();
    await until(() => useGame.getState().conn === 'connected');
    await wait(500);
    expect([useGame.getState().mode, useGame.getState().room]).toEqual(['local', null]);
    useGame.getState().set({ mode: null });
    net.disconnect();
  }, 20000);
});
