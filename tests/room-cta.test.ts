// 电脑版首页“创建房间”入口：真实的客户端代码 + 真实的游戏服务器
// 重点：连续点击只创建一个房间（客户端合并 + 服务器按 requestId 去重）、失败与超时有结果、入口状态跟随真实状态、离开后不残留
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from '../server/index';
import type { ClientMessage, RoomInfo, ServerMessage } from '../src/core/protocol';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
};
const g = globalThis as any;
g.window ??= globalThis;
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
g.sessionStorage ??= mem();
g.localStorage ??= mem();

let srv: Awaited<ReturnType<typeof createServer>>;
let net: typeof import('../src/net/netClient').net;
let session: typeof import('../src/net/session').session;
let useGame: typeof import('../src/store/gameStore').useGame;
let quick: typeof import('../src/net/quickRoom');

beforeAll(async () => {
  srv = await createServer(0, { pace: 0.02, turnTimeMs: 600, lobbyGraceMs: 2000, connLimits: { perIp: 1000, perMinute: 10000 } });
  g.location = { protocol: 'http:', host: `127.0.0.1:${srv.port}`, hostname: '127.0.0.1', origin: `http://127.0.0.1:${srv.port}` };
  ({ net } = await import('../src/net/netClient'));
  ({ session } = await import('../src/net/session'));
  ({ useGame } = await import('../src/store/gameStore'));
  quick = await import('../src/net/quickRoom');
});
afterAll(async () => {
  net.disconnect();
  await srv.close();
});
beforeEach(() => {
  session.leave('home');
  net.disconnect();
  quick.useQuickRoom.setState({ phase: 'idle' });
});

async function until(cond: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roomCount = async () => ((await (await fetch(`http://127.0.0.1:${srv.port}/health`)).json()) as { rooms: number }).rooms;

/** 直接用 WebSocket 连接服务器（检查服务器本身的去重，不经过客户端的合并） */
async function rawClient() {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  const inbox: ServerMessage[] = [];
  ws.onmessage = (e) => inbox.push(JSON.parse(String(e.data)));
  await new Promise((r) => (ws.onopen = r));
  const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
  send({ t: 'hello', profile: { name: '测试', animal: {} as any, level: 1 } });
  await until(() => inbox.some((m) => m.t === 'welcome'));
  return { ws, inbox, send, rooms: () => inbox.filter((m): m is Extract<ServerMessage, { t: 'room' }> => m.t === 'room').map((m) => m.room) };
}

const SETTINGS = { maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 };

describe('服务器：同一个创建请求只创建一个房间', () => {
  it('CTA-01 同一个 requestId 到达 3 次：只有一个房间，重复的请求重新发回同一个房间', async () => {
    const before = await roomCount();
    const c = await rawClient();
    for (let i = 0; i < 3; i++) c.send({ t: 'createRoom', settings: SETTINGS, requestId: 'req-1' });
    await until(() => c.rooms().filter(Boolean).length >= 2);
    await wait(150);
    const codes = new Set(c.rooms().filter((r): r is RoomInfo => !!r).map((r) => r.code));
    expect(codes.size).toBe(1);
    expect(await roomCount()).toBe(before + 1);
    expect(c.inbox.filter((m) => m.t === 'error')).toHaveLength(0);
    c.ws.close();
  });

  it('CTA-02 不同的 requestId（或旧客户端没有 requestId）：照旧离开原房间、创建新房间，房间数不会累积', async () => {
    const before = await roomCount();
    const c = await rawClient();
    c.send({ t: 'createRoom', settings: SETTINGS, requestId: 'a' });
    await until(() => c.rooms().filter(Boolean).length === 1);
    const first = c.rooms().find(Boolean)!.code;
    c.send({ t: 'createRoom', settings: SETTINGS });
    await until(() => c.rooms().filter(Boolean).length === 2);
    const second = c.rooms().filter(Boolean)[1]!.code;
    expect(second).not.toBe(first);
    // 原房间已经没有人：被删除（不会因为“创建房间”留下空房间）
    expect(await roomCount()).toBe(before + 1);
    c.ws.close();
  });
});

describe('客户端：一键创建房间', () => {
  it('CTA-03 在首页连续点击 3 次：只发出一个请求、只创建一个房间，自动进入房间大厅，并提示房间代码', async () => {
    const before = await roomCount();
    const g0 = useGame.getState();
    expect(g0.screen).toBe('home');
    const sent: ClientMessage[] = [];
    const raw = (net as any).raw.bind(net);
    (net as any).raw = (m: ClientMessage) => {
      sent.push(m);
      raw(m);
    };
    try {
      const p = [quick.quickCreateRoom(), quick.quickCreateRoom(), quick.quickCreateRoom()];
      expect(quick.useQuickRoom.getState().phase).toBe('creating');
      // 正在创建时首页的“释放连接”不能把请求断掉
      net.releaseIfIdle();
      expect(net.creatingRoom).toBe(true);
      await Promise.all(p);
    } finally {
      (net as any).raw = raw;
    }
    const s = useGame.getState();
    expect(sent.filter((m) => m.t === 'createRoom')).toHaveLength(1);
    expect(s.screen).toBe('room');
    expect(s.room?.hostId).toBe(s.playerId);
    expect(s.lastRoom).toBe(s.room!.code);
    expect(await roomCount()).toBe(before + 1);
    expect(s.toasts.some((t) => t.text.includes(`房间已创建 · ${s.room!.code}`))).toBe(true);
    expect(quick.useQuickRoom.getState().phase).toBe('idle');
    // 入口状态：已在房间里 → 返回房间（不会再创建第二个）
    expect(quick.roomCtaState({ room: s.room, mode: s.mode, hasView: false, lastRoom: s.lastRoom, conn: s.conn, request: quick.useQuickRoom.getState() })).toEqual({ kind: 'lobby', code: s.room!.code });
  });

  it('CTA-04 离开房间回到首页：房间、牌局、聊天、最近房间全部清空，入口恢复为“创建房间”', async () => {
    await quick.quickCreateRoom();
    expect(useGame.getState().room).not.toBeNull();
    session.leave('home');
    const s = useGame.getState();
    expect([s.screen, s.room, s.view, s.mode, s.lastRoom, s.chat.length, s.pendingAction]).toEqual(['home', null, null, null, null, 0, null]);
    expect(sessionStorage.getItem('apc-last-room')).toBeNull();
    expect(quick.roomCtaState({ room: s.room, mode: s.mode, hasView: false, lastRoom: s.lastRoom, conn: s.conn, request: quick.useQuickRoom.getState() })).toEqual({ kind: 'create' });
  });

  it('CTA-05 服务器拒绝（错误消息）：返回失败与原因，入口显示“创建失败 · 重试”，不留在“正在创建”', async () => {
    const r = await net.requestCreateRoom({ ...SETTINGS, maxPlayers: 99 });
    expect(r).toEqual({ ok: false, message: '房间设置无效' });
    expect(net.creatingRoom).toBe(false);
    quick.useQuickRoom.setState({ phase: 'error', message: '房间设置无效' });
    const s = useGame.getState();
    expect(quick.roomCtaState({ room: null, mode: null, hasView: false, lastRoom: null, conn: s.conn, request: quick.useQuickRoom.getState() })).toEqual({ kind: 'error', message: '房间设置无效' });
    // 再次进入首页时失败提示消失
    useGame.getState().setScreen('settings');
    useGame.getState().setScreen('home');
    expect(quick.useQuickRoom.getState().phase).toBe('idle');
  });

  it('CTA-06 服务器一直连不上（超时）：返回失败，还没发出的请求被撤回，之后连上也不会创建房间', async () => {
    const before = await roomCount();
    // 服务器地址暂时指向一个没有服务的端口：请求只能留在队列里
    const real = g.location;
    g.location = { ...real, host: '127.0.0.1:1' };
    let r;
    try {
      const p = net.requestCreateRoom(SETTINGS, 150);
      expect((net as any).queue.some((m: ClientMessage) => m.t === 'createRoom')).toBe(true);
      r = await p;
    } finally {
      g.location = real;
    }
    expect(r.ok).toBe(false);
    expect((net as any).queue.some((m: ClientMessage) => m.t === 'createRoom')).toBe(false);
    // 服务器恢复后连上：之前撤回的请求不会再创建房间
    net.disconnect();
    net.connect();
    await until(() => useGame.getState().conn === 'connected');
    await wait(200);
    expect(useGame.getState().room).toBeNull();
    expect(await roomCount()).toBe(before);
  });

  it('CTA-07 断开连接时正在创建：立即返回失败（不会一直显示“正在创建”）', async () => {
    const p = net.requestCreateRoom(SETTINGS);
    net.disconnect();
    expect(await p).toEqual({ ok: false, message: '与服务器的连接已断开，请重试' });
  });
});

describe('入口状态（只看真实状态）', () => {
  const base = { room: null, mode: null, hasView: false, lastRoom: null, conn: 'idle' as const, request: { phase: 'idle' as const } };
  const room = (status: RoomInfo['status'], solo = false) => ({ code: 'K7M4XP', status, solo }) as unknown as RoomInfo;
  it('CTA-08 各种状态', () => {
    expect(quick.roomCtaState(base)).toEqual({ kind: 'create' });
    expect(quick.roomCtaState({ ...base, request: { phase: 'creating', since: 0 }, conn: 'connecting' })).toEqual({ kind: 'creating', conn: 'connecting' });
    expect(quick.roomCtaState({ ...base, room: room('lobby') })).toEqual({ kind: 'lobby', code: 'K7M4XP' });
    expect(quick.roomCtaState({ ...base, room: room('playing') })).toEqual({ kind: 'game', code: 'K7M4XP' });
    expect(quick.roomCtaState({ ...base, room: room('playing', true), hasView: true })).toEqual({ kind: 'game', code: null });
    expect(quick.roomCtaState({ ...base, mode: 'local', hasView: true })).toEqual({ kind: 'game', code: null });
    // 刷新后正在回到原来的房间：显示重新连接，而不是创建新房间
    expect(quick.roomCtaState({ ...base, lastRoom: 'ABC234', conn: 'connecting' })).toEqual({ kind: 'reconnect', code: 'ABC234', conn: 'connecting' });
    // 关闭浏览器后再打开（会话存储已清除 / 没有连接）：不会显示“返回 ABC234”
    expect(quick.roomCtaState({ ...base, lastRoom: 'ABC234', conn: 'idle' })).toEqual({ kind: 'create' });
    expect(quick.roomCtaState({ ...base, request: { phase: 'error', message: 'x' } })).toEqual({ kind: 'error', message: 'x' });
  });

  it('CTA-09 服务器重启后旧房间失效：最近房间被清除，入口恢复为“创建房间”', async () => {
    await quick.quickCreateRoom();
    const s = useGame.getState();
    expect(s.lastRoom).not.toBeNull();
    (net as any).handle({ t: 'welcome', sessionId: net.sessionId, playerId: s.playerId, resumed: false });
    expect(useGame.getState().lastRoom).toBeNull();
    expect(sessionStorage.getItem('apc-last-room')).toBeNull();
  });

  it('CTA-10 刷新后在首页等待回到房间，但房间已经不存在：清除最近房间，并断开首页的多人连接', async () => {
    for (const msg of [
      (sid: string | undefined, pid: string) => ({ t: 'welcome', sessionId: sid, playerId: pid, resumed: false }),
      () => ({ t: 'room', room: null }),
    ]) {
      await quick.quickCreateRoom();
      const code = useGame.getState().room!.code;
      // 模拟刷新后的首页：还没有房间信息，只记得刚才的房间，连接已建立
      useGame.getState().set({ room: null, mode: null, view: null, screen: 'home' });
      expect(useGame.getState().lastRoom).toBe(code);
      expect(useGame.getState().conn).toBe('connected');
      (net as any).handle(msg(net.sessionId, useGame.getState().playerId!));
      await wait(0);
      expect(useGame.getState().lastRoom).toBeNull();
      expect(useGame.getState().conn).toBe('idle');
    }
  });
});
