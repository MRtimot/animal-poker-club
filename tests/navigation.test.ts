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
