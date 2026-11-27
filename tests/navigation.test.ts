// 首页 ↔ 牌局 ↔ 结束 ↔ 首页：导航与清理（使用真实的客户端代码 + 真实的游戏服务器）
// 重点：离开后不会被旧消息拉回牌桌、连接与计时器被清理、可以反复进入、玩家存档不受影响
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../server/index';

// 让浏览器端代码可以在 Node 中运行（Node 24 自带 WebSocket）
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
let local: typeof import('../src/net/localHost');
let useProfile: typeof import('../src/store/profileStore').useProfile;
let voice: typeof import('../src/audio/voice').voice;

beforeAll(async () => {
  srv = await createServer(0, { pace: 0.02, turnTimeMs: 600, lobbyGraceMs: 2000, connLimits: { perIp: 1000, perMinute: 10000 } });
  g.location = { protocol: 'http:', host: `127.0.0.1:${srv.port}`, hostname: '127.0.0.1', origin: `http://127.0.0.1:${srv.port}` };
  ({ net } = await import('../src/net/netClient'));
  ({ session } = await import('../src/net/session'));
  ({ useGame } = await import('../src/store/gameStore'));
  ({ useProfile } = await import('../src/store/profileStore'));
  ({ voice } = await import('../src/audio/voice'));
  local = await import('../src/net/localHost');
});
afterAll(async () => {
  net.disconnect();
  await srv.close();
});

async function until(cond: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timers = () => ({ ws: (net as any).ws, ping: (net as any).pingTimer, rotate: (net as any).rotateTimer, retry: (net as any).retryTimer, queue: (net as any).queue.length });

/** 首页 → 创建房间 → 加 AI → 开始游戏 → 牌局中 */
async function createAndStart() {
  const gs = useGame.getState();
  gs.setScreen('online');
  net.createRoom({ maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } as any);
  await until(() => useGame.getState().screen === 'room' && !!useGame.getState().room);
  const code = useGame.getState().room!.code;
  net.addAI('aggressiveFox', 'easy');
  net.addAI('crazyFrog', 'easy');
  await until(() => useGame.getState().room!.members.length === 3);
  net.startGame();
  await until(() => useGame.getState().screen === 'game' && !!useGame.getState().view);
  return code;
}

describe('在线房间：牌局 → 返回首页 → 再进入', () => {
  it('离开后不会被路上的旧消息拉回牌桌；游客的连接与计时器全部清理；房间被服务器删除', async () => {
    const save = JSON.stringify(useProfile.getState().animal);
    for (let round = 0; round < 3; round++) {
      const code = await createAndStart();
      expect(srv.rooms.getRoom(code)).toBeTruthy();
      // AI 在服务器上快速行动，状态消息不断发来；此时离开
      await wait(150);
      session.leave('home');
      let s = useGame.getState();
      expect(s.screen).toBe('home');
      expect([s.view, s.room, s.mode, s.pendingAction, s.modal]).toEqual([null, null, null, null, null]);
      expect(s.chat).toEqual([]);
      // 等一会儿：旧的牌局状态 / 房间更新仍可能到达，但不能把玩家拉回去
      await wait(800);
      s = useGame.getState();
      expect(s.screen, `第 ${round + 1} 次`).toBe('home');
      expect(s.view).toBeNull();
      expect(s.room).toBeNull();
      // 游客：离开确认后断开连接，心跳 / 换连接 / 重连计时器都已清除
      await until(() => !timers().ws);
      expect(timers()).toEqual({ ws: null, ping: null, rotate: null, retry: null, queue: 0 });
      expect(s.conn).toBe('idle');
      // 最后一名真人离开：服务器删除房间（AI 停止）
      await until(() => !srv.rooms.getRoom(code));
    }
    // 玩家永久存档没有被动过
    expect(JSON.stringify(useProfile.getState().animal)).toBe(save);
  }, 60000);

  it('直接注入“离开前发出的旧消息”：全部被忽略；收到离开确认后恢复正常处理', async () => {
    await createAndStart();
    const view = useGame.getState().view!;
    const room = { ...useGame.getState().room! };
    session.leave('home');
    const handle = (m: any) => (net as any).handle(m);
    handle({ t: 'state', view });
    handle({ t: 'room', room });
    handle({ t: 'chat', message: { id: 'x', from: 'a', name: 'a', text: 'hi', kind: 'chat', time: 0 } });
    let s = useGame.getState();
    expect([s.screen, s.view, s.room, s.chat.length]).toEqual(['home', null, null, 0]);
    await until(() => !timers().ws);
    // 离开已确认：之后新的房间消息正常处理（例如重新创建房间）
    expect((net as any).leavingRoom).toBe(false);
  }, 30000);

  it('离开后立刻创建新房间：不会因为“离开后断开”把新房间断掉', async () => {
    await createAndStart();
    session.leave('online');
    net.createRoom({ maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } as any);
    await until(() => useGame.getState().screen === 'room' && !!useGame.getState().room);
    await wait(300);
    expect(timers().ws).toBeTruthy();
    expect(useGame.getState().conn).toBe('connected');
    session.leave('home');
    await until(() => !timers().ws);
  }, 30000);

  it('从房间离开回到在线页面：离开确认后仍保持连接，可以直接创建新房间（不会被“离开后断开”卡住）', async () => {
    await createAndStart();
    session.leave('online');
    await until(() => !(net as any).leavingRoom);
    await wait(400);
    expect(useGame.getState().screen).toBe('online');
    expect(timers().ws).toBeTruthy();
    expect(useGame.getState().conn).toBe('connected');
    net.createRoom({ maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } as any);
    await until(() => useGame.getState().screen === 'room' && !!useGame.getState().room);
    session.leave('home');
    await until(() => !timers().ws);
  }, 30000);

  it('连续点击“返回首页”：只清理一次，不出错，不残留', async () => {
    await createAndStart();
    session.leave('home');
    session.leave('home');
    session.leave('home');
    await wait(500);
    const s = useGame.getState();
    expect([s.screen, s.view, s.room]).toEqual(['home', null, null]);
    await until(() => !timers().ws);
  }, 30000);
});

describe('首页不保持多人连接', () => {
  it('服务器连不上时从在线页回到首页：停止重连，不在后台一直重试', async () => {
    const realUrl = net.url.bind(net);
    (net as any).url = () => 'ws://127.0.0.1:1/api/ws'; // 不存在的服务器
    try {
      net.connect();
      await until(() => !!timers().retry, 5000);
      expect(useGame.getState().conn).toBe('disconnected');
      useGame.getState().setScreen('home');
      net.releaseIfIdle();
      expect(timers()).toEqual({ ws: null, ping: null, rotate: null, retry: null, queue: 0 });
      await wait(1200);
      expect(timers().ws).toBeNull(); // 没有再次尝试连接
    } finally {
      (net as any).url = realUrl;
    }
  });

  it('在房间里时 releaseIfIdle 不会断开（不影响正在进行的在线对局）', async () => {
    await createAndStart();
    net.releaseIfIdle();
    expect(timers().ws).toBeTruthy();
    session.leave('home');
    await until(() => !timers().ws);
  }, 30000);
});

describe('本地 AI 对战：结束 → 返回首页 → 再来', () => {
  it('离开后 AI 停止（不再更新牌桌、不再说话），可以反复开始新的一局', async () => {
    const settings = { opponents: [{ personality: 'crazyFrog' as const, difficulty: 'easy' as const }, { personality: 'aggressiveFox' as const, difficulty: 'easy' as const }], startingChips: 1000, smallBlind: 10, bigBlind: 20 };
    for (let round = 0; round < 3; round++) {
      local.startLocalGame(settings);
      useGame.getState().setScreen('game');
      await until(() => !!useGame.getState().view && useGame.getState().view!.handNumber >= 1);
      session.leave('home');
      const s = useGame.getState();
      expect([s.screen, s.view, s.mode]).toEqual(['home', null, null]);
      expect(voice.speaking).toBe(false);
      // AI 的计时器已经停止：几秒内牌桌与聊天都不会再被更新
      let changed = false;
      const unsub = useGame.subscribe((n, p) => {
        if (n.view !== p.view || n.chat !== p.chat) changed = true;
      });
      await wait(2500);
      unsub();
      expect(changed, `第 ${round + 1} 次`).toBe(false);
      expect(local.localAction({ type: 'check' })).toBe('游戏未开始');
    }
  }, 60000);

  it('再来一局：全新的对局（第 1 手、筹码重置），不沿用旧状态', async () => {
    const settings = { opponents: [{ personality: 'crazyFrog' as const, difficulty: 'easy' as const }], startingChips: 800, smallBlind: 10, bigBlind: 20 };
    local.startLocalGame(settings);
    useGame.getState().setScreen('game');
    await until(() => !!useGame.getState().view);
    session.playAgain();
    const v = useGame.getState().view!;
    expect(v.handNumber).toBeLessThanOrEqual(1);
    expect(v.gameOver).toBeFalsy();
    expect(v.players.reduce((a, p) => a + p.chips + (p.bet ?? 0), 0)).toBeLessThanOrEqual(1600);
    session.leave('home');
  }, 20000);
});

describe('深度审计回归（真实客户端 + 真实服务器）', () => {
  const solo = { opponents: [{ personality: 'smartCat' as const, difficulty: 'easy' as const }], startingChips: 1000, smallBlind: 10, bigBlind: 20 };

  it('BUG-04 连续点击“开始对局”：只发出一次请求；两次调用得到同一个结果；超时后不会把已开始的对局切换成离线对局', async () => {
    useGame.getState().setScreen('quick');
    const p1 = net.startSolo(solo, 1500);
    const p2 = net.startSolo(solo, 1500);
    expect(p2).toBe(p1);
    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    const code = useGame.getState().room!.code;
    // 以前：第一次调用的计时器会在这里超时并返回 false
    await wait(1800);
    const s = useGame.getState();
    expect(s.mode).toBe('online');
    expect(s.room?.code).toBe(code);
    expect(s.room?.solo).toBe(true);
    expect((net as any).soloStarting).toBeNull();
    session.leave('home');
    await until(() => !timers().ws);
    await until(() => !srv.rooms.getRoom(code));
  }, 20000);

  it('BUG-05 连接上收到结构不对的消息：丢弃，不会抛错，也不会改动牌局 / 房间状态', async () => {
    await createAndStart();
    const before = useGame.getState();
    const ws = (net as any).ws as WebSocket;
    const junk = ['{oops', JSON.stringify({ t: 'state' }), JSON.stringify({ t: 'state', view: { players: 'x' } }), JSON.stringify({ t: 'room', room: { code: 1 } }), JSON.stringify({ t: 'chat', message: null }), JSON.stringify({ t: 'zzz' })];
    for (const data of junk) expect(() => (ws.onmessage as any)({ data })).not.toThrow();
    const after = useGame.getState();
    expect(after.view).toBe(before.view);
    expect(after.room).toBe(before.room);
    expect(after.chat).toBe(before.chat);
    expect(after.screen).toBe('game');
    session.leave('home');
    await until(() => !timers().ws);
  }, 30000);

  it('BUG-06 登录 / 退出后重新连接：旧连接的消息处理全部解除，旧身份的消息不会再被处理', async () => {
    net.connect();
    await until(() => useGame.getState().conn === 'connected');
    const old = (net as any).ws as WebSocket;
    const oldPlayer = useGame.getState().playerId;
    net.reconnect();
    expect(old.onmessage).toBeNull();
    expect(old.onclose).toBeNull();
    expect((net as any).rotateTimer).toBeNull();
    await until(() => useGame.getState().conn === 'connected' && (net as any).ws !== old && useGame.getState().playerId !== oldPlayer);
    net.disconnect();
  }, 20000);
});

describe('Cookie / 会话 / 存储审计回归（真实客户端）', () => {
  it('SESS-01 同一会话在另一个页面打开：本页面停止自动重连（不会互相挤掉、无限重连），清除本标签页会话，下次连接成为新玩家', async () => {
    await createAndStart();
    const code = useGame.getState().room!.code;
    const sid = net.sessionId!;
    const myId = useGame.getState().playerId;
    // 另一个页面（复制出来的标签页）用同一个会话连接
    const other = new WebSocket(`ws://127.0.0.1:${srv.port}/api/ws`);
    const otherMsgs: any[] = [];
    other.onmessage = (e) => otherMsgs.push(JSON.parse(String(e.data)));
    await new Promise((r) => (other.onopen = r));
    other.send(JSON.stringify({ t: 'hello', sessionId: sid, profile: { name: '另一个标签页', animal: useProfile.getState().animal } }));
    await until(() => !timers().ws);
    const s = useGame.getState();
    expect(s.conn).toBe('idle');
    expect([s.mode, s.view, s.room]).toEqual([null, null, null]);
    expect(s.screen).toBe('online');
    expect(s.toasts.some((t) => t.text.includes('另一个标签页'))).toBe(true);
    expect(net.sessionId).toBeUndefined();
    // 不会自动重连回去把对方挤掉
    await wait(1500);
    expect(timers()).toEqual({ ws: null, ping: null, rotate: null, retry: null, queue: 0 });
    expect(otherMsgs.find((m) => m.t === 'welcome')?.playerId).toBe(myId);
    // 下次连接：新的会话、新的玩家
    net.connect();
    await until(() => useGame.getState().conn === 'connected');
    expect(useGame.getState().playerId).not.toBe(myId);
    other.send(JSON.stringify({ t: 'leaveRoom' }));
    await until(() => !srv.rooms.getRoom(code));
    other.close();
    net.disconnect();
  }, 30000);

  it('SESS-02 牌局中身份变化（另一个标签页登录 / 退出）：先在旧连接上离开房间，座位立即释放，而不是留下一个“断线”的座位等超时', async () => {
    const code = await createAndStart();
    const oldId = useGame.getState().playerId;
    net.reconnect();
    // 本地立即回到在线页面，不显示旧身份的牌桌
    const s = useGame.getState();
    expect([s.room, s.view, s.mode]).toEqual([null, null, null]);
    expect(s.screen).toBe('online');
    // 最后一名真人离开 → 服务器立即删除房间（断线宽限是 2.5 秒，这里要求 1 秒内）
    const t0 = Date.now();
    await until(() => !srv.rooms.getRoom(code), 1000);
    expect(Date.now() - t0).toBeLessThan(1000);
    await until(() => useGame.getState().conn === 'connected' && useGame.getState().playerId !== oldId);
    net.disconnect();
  }, 30000);
});

describe('协议版本', () => {
  it('PROTO-01 服务器在欢迎消息里告知协议版本；版本不一致时提示刷新（只提示一次，不自动刷新页面）', async () => {
    const { PROTOCOL_VERSION } = await import('../src/core/protocol');
    net.connect();
    await until(() => useGame.getState().conn === 'connected');
    const before = useGame.getState().toasts.length;
    const sid = net.sessionId!;
    const pid = useGame.getState().playerId!;
    (net as any).handle({ t: 'welcome', sessionId: sid, playerId: pid, protocol: PROTOCOL_VERSION });
    expect(useGame.getState().toasts.length).toBe(before);
    (net as any).handle({ t: 'welcome', sessionId: sid, playerId: pid, protocol: PROTOCOL_VERSION + 1 });
    (net as any).handle({ t: 'welcome', sessionId: sid, playerId: pid, protocol: PROTOCOL_VERSION + 1 });
    const warned = useGame.getState().toasts.filter((t) => t.text.includes('刷新页面'));
    expect(warned).toHaveLength(1);
    net.disconnect();
  });
});

describe('全面审计回归（2026-11，真实客户端 + 真实服务器）', () => {
  it('AUD-01 离开房间时路上的旧 21 点 / 百家乐状态也被忽略：不会把玩家从首页拉回一张卡住的旧牌桌', async () => {
    await createAndStart();
    session.leave('home');
    const handle = (m: any) => (net as any).handle(m);
    // 以前只忽略德州（state）与 21 点（bjState），漏了百家乐（bacState）
    handle({ t: 'bacState', view: { kind: 'baccarat', viewerId: 'x', round: 1, roundId: 'r', phase: 'betting', serverTime: Date.now(), players: [], events: [] } });
    handle({ t: 'bjState', view: { kind: 'blackjack', viewerId: 'x', round: 1, roundId: 'r', phase: 'betting', token: 1, serverTime: Date.now(), players: [], events: [] } });
    const s = useGame.getState();
    expect([s.screen, s.view, s.bj, s.bac, s.room]).toEqual(['home', null, null, null, null]);
    await until(() => !timers().ws);
  }, 30000);

  it('AUD-02 回到前台时连接已失效（心跳没有回应、浏览器迟迟不触发关闭）：几秒内换一条新连接，不等关闭握手超时', async () => {
    net.connect();
    await until(() => useGame.getState().conn === 'connected');
    const dead = (net as any).ws as WebSocket;
    const pid = useGame.getState().playerId;
    // 模拟锁屏期间被系统断开的连接：发出的消息到不了服务器，close() 之后浏览器也一直不触发 onclose
    dead.send = () => undefined;
    const realClose = dead.close.bind(dead);
    dead.close = () => undefined;
    net.noteHidden();
    (net as any).hiddenAt = Date.now() - 10_000;
    const t0 = Date.now();
    net.wake();
    await until(() => (net as any).ws && (net as any).ws !== dead && useGame.getState().conn === 'connected', 8000);
    // 心跳等 4 秒没有回应 → 立刻换连接（重连退避从 0 开始，约 0.5 秒）
    expect(Date.now() - t0).toBeLessThan(6500);
    // 同一个会话：还是同一名玩家
    expect(useGame.getState().playerId).toBe(pid);
    // 旧连接的消息处理已经解除：之后它的任何消息都不会再被处理
    expect([dead.onmessage, dead.onclose]).toEqual([null, null]);
    realClose();
    net.disconnect();
  }, 20000);
});
