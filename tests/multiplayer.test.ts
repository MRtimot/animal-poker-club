// 多人在线：限流、重复动作、非法请求、重连、游客模式（无数据库）、2 / 4 / 6 人牌局负载
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import type { ServerMessage, RoomInfo } from '../src/core/protocol';
import type { TableView } from '../src/core/game/view';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import { ROOM_CODE_LENGTH } from '../src/core/utils/random';

let srv: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  // 所有测试客户端来自同一个 IP，放宽连接限制（IP 限制在下面单独测试）
  srv = await createServer(0, { pace: 0.02, turnTimeMs: 600, lobbyGraceMs: 2000, connLimits: { perIp: 1000, perMinute: 10000 } });
});
afterAll(async () => {
  await srv.close();
});

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
  bytes = 0;
  constructor(public name: string) {}
  async connect(sessionId?: string) {
    this.ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    this.ws.on('message', (d) => {
      this.bytes += (d as Buffer).length;
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      if (m.t === 'welcome') {
        this.sessionId = m.sessionId;
        this.playerId = m.playerId;
        this.resumed = m.resumed;
      }
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'state') {
        // 与客户端相同：增量事件追加到本手已有事件后面
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
  acks(id: string) {
    return this.msgs.filter((m) => m.t === 'ack' && m.actionId === id) as Extract<ServerMessage, { t: 'ack' }>[];
  }
  close() {
    this.ws.close();
  }
}

/** 建房 + 加入 + 开始 */
async function table(n: number, chips = 1000) {
  const ps = Array.from({ length: n }, (_, i) => new Player(`玩家${i + 1}`));
  for (const p of ps) await p.connect();
  ps[0].send({ t: 'createRoom', settings: { maxPlayers: Math.max(2, n), startingChips: chips, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
  await until(() => !!ps[0].room);
  const code = ps[0].room!.code;
  for (const p of ps.slice(1)) p.send({ t: 'joinRoom', code });
  await until(() => ps[0].room!.members.length === n);
  for (const p of ps.slice(1)) p.send({ t: 'ready', ready: true });
  await until(() => ps[0].room!.members.every((m) => m.ready));
  ps[0].send({ t: 'startGame' });
  await until(() => ps.every((p) => p.view && p.view.handNumber >= 1 && p.view.currentPlayerId !== null));
  return { ps, code };
}

describe('房间与连接', () => {
  it(`房间代码为 ${ROOM_CODE_LENGTH} 位；错误的房间代码被拒绝；房主才能开始`, async () => {
    const a = new Player('甲');
    const b = new Player('乙');
    await a.connect();
    await b.connect();
    a.send({ t: 'createRoom', settings: { maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => !!a.room);
    expect(a.room!.code).toMatch(new RegExp(`^[A-Z2-9]{${ROOM_CODE_LENGTH}}$`));
    b.send({ t: 'joinRoom', code: 'ZZZZZZ' });
    b.send({ t: 'joinRoom', code: { evil: true } });
    await until(() => b.errors.length >= 2);
    expect(b.errors[0]).toContain('房间不存在');
    b.send({ t: 'joinRoom', code: a.room!.code.toLowerCase() });
    await until(() => !!b.room);
    b.send({ t: 'startGame' });
    await until(() => b.errors.some((e) => e.includes('只有房主')));
    b.send({ t: 'leaveRoom' });
    await until(() => a.room!.members.length === 1);
    a.close();
    b.close();
  });

  it('房间最多 6 人：超过上限的房间设置被拒绝', async () => {
    const p = new Player('房主');
    await p.connect();
    p.send({ t: 'createRoom', settings: { maxPlayers: 7, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => p.errors.length > 0);
    expect(p.errors[0]).toContain('房间设置无效');
    expect(p.room).toBeNull();
    p.close();
  });

  it('游客昵称不能冒充系统 / 管理员', async () => {
    const p = new Player('管理员');
    await p.connect();
    p.send({ t: 'createRoom', settings: { maxPlayers: 2, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => !!p.room);
    expect(p.room!.members[0].profile.name).not.toContain('管理员');
    expect(p.room!.members[0].profile.name).toMatch(/^玩家\d{4}$/);
    p.close();
  });

  it('断线重连：保留座位与牌局；未知会话（服务器重启）返回 resumed=false', async () => {
    const { ps } = await table(2);
    const sid = ps[1].sessionId;
    const seatId = ps[1].playerId;
    ps[1].close();
    await until(() => ps[0].room!.members.some((m) => m.id === seatId && !m.connected));
    const back = new Player('玩家2');
    await back.connect(sid);
    expect(back.resumed).toBe(true);
    expect(back.playerId).toBe(seatId);
    await until(() => !!back.view);
    expect(back.view!.players.find((p) => p.id === seatId)!.hole.every((c) => c !== null)).toBe(true);
    const stranger = new Player('陌生人');
    await stranger.connect('session-that-does-not-exist');
    expect(stranger.resumed).toBe(false);
    for (const p of [...ps, back, stranger]) p.close();
  });
});

describe('牌局动作校验', () => {
  it('同一个 actionId 重复发送只执行一次；过期、越权、非法动作被拒绝', async () => {
    const { ps } = await table(3, 5000);
    const v = ps[0].view!;
    const actor = ps.find((p) => p.playerId === v.currentPlayerId)!;
    const other = ps.find((p) => p !== actor)!;

    // 不是你的回合
    other.send({ t: 'action', action: { type: 'call' }, actionId: 'notmine1', hand: v.handNumber });
    await until(() => other.acks('notmine1').length === 1);
    expect(other.acks('notmine1')[0].ok).toBe(false);

    // 非法动作 / 非法金额
    actor.send({ t: 'action', action: { type: 'steal' }, actionId: 'bad1' });
    actor.send({ t: 'action', action: { type: 'raise', amount: 999999999 }, actionId: 'bad2', hand: v.handNumber });
    actor.send({ t: 'action', action: { type: 'raise', amount: 1 }, actionId: 'bad3', hand: v.handNumber });
    // 过期动作（上一手牌）
    actor.send({ t: 'action', action: { type: 'call' }, actionId: 'old1', hand: v.handNumber - 1 });
    await until(() => ['bad1', 'bad2', 'bad3', 'old1'].every((id) => actor.acks(id).length === 1));
    for (const id of ['bad1', 'bad2', 'bad3', 'old1']) expect(actor.acks(id)[0].ok).toBe(false);
    expect(actor.acks('old1')[0].message).toContain('已经结束');

    // 同一个动作疯狂点击 5 次：只执行一次
    const before = ps[0].view!.events.filter((e) => e.type === 'action').length;
    for (let i = 0; i < 5; i++) actor.send({ t: 'action', action: { type: 'call' }, actionId: 'dup1', hand: v.handNumber });
    await until(() => actor.acks('dup1').length === 5);
    const acks = actor.acks('dup1');
    expect(acks[0].ok).toBe(true);
    expect(acks.slice(1).every((a) => a.duplicate && a.ok)).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    const myActions = ps[0].view!.events.filter((e) => e.type === 'action' && e.playerId === actor.playerId).length;
    const allActions = ps[0].view!.events.filter((e) => e.type === 'action').length;
    expect(myActions).toBe(1);
    expect(allActions).toBeGreaterThanOrEqual(before + 1);
    for (const p of ps) p.close();
  });

  it('底牌保密：每个客户端只收到自己的底牌', async () => {
    const { ps } = await table(4);
    for (const p of ps) {
      const v = p.view!;
      for (const seat of v.players) {
        if (seat.id === p.playerId) expect(seat.hole.every((c) => c !== null)).toBe(true);
        else expect(seat.hole.every((c) => c === null)).toBe(true);
      }
    }
    for (const p of ps) p.close();
  });
});

describe('限流', () => {
  it('聊天刷屏被限速；疯狂发送消息的连接被断开', async () => {
    const { ps } = await table(2);
    const [a, b] = ps;
    const before = b.msgs.filter((m) => m.t === 'chat' && m.message.from === a.playerId).length;
    for (let i = 0; i < 20; i++) a.send({ t: 'chat', text: `刷屏 ${i}` });
    await until(() => a.errors.some((e) => e.includes('太频繁')));
    await new Promise((r) => setTimeout(r, 150));
    const got = b.msgs.filter((m) => m.t === 'chat' && m.message.from === a.playerId).length - before;
    expect(got).toBeLessThanOrEqual(6);

    const spammer = new Player('刷子');
    await spammer.connect();
    let closed = false;
    spammer.ws.on('close', () => (closed = true));
    for (let i = 0; i < 200; i++) spammer.send({ t: 'ping', time: i });
    await until(() => closed, 3000);
    expect(closed).toBe(true);
    for (const p of ps) p.close();
  });

  it('同一 IP 的并发连接数受限', async () => {
    const small = await createServer(0, { connLimits: { perIp: 3, perMinute: 100 } });
    try {
      const states = await Promise.all(
        Array.from({ length: 5 }, () =>
          new Promise<WebSocket>((resolve) => {
            const ws = new WebSocket(`ws://localhost:${small.port}/ws`);
            ws.on('open', () => setTimeout(() => resolve(ws), 150));
            ws.on('error', () => resolve(ws));
          }),
        ),
      );
      const openCount = states.filter((w) => w.readyState === WebSocket.OPEN).length;
      expect(openCount).toBe(3);
      states.forEach((w) => w.close());
    } finally {
      await small.close();
    }
  });

  it('建房频率受限', async () => {
    const p = new Player('建房狂');
    await p.connect();
    for (let i = 0; i < 20; i++) p.send({ t: 'createRoom', settings: { maxPlayers: 2, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => p.errors.some((e) => e.includes('太频繁')));
    const created = new Set(p.msgs.filter((m) => m.t === 'room' && m.room).map((m: any) => m.room.code));
    expect(created.size).toBeLessThanOrEqual(12);
    p.close();
  });
});

describe('游客模式（RM0：不使用数据库）', () => {
  it('没有配置 Google 登录时：不提供账号接口', async () => {
    const cfg = await fetch(`http://localhost:${srv.port}/api/auth/config`).then((r) => r.json());
    expect(cfg.accounts).toBe(false);
    expect(srv.accounts).toBeNull();
    expect((await fetch(`http://localhost:${srv.port}/api/player/me`)).status).toBe(404);
    expect((await fetch(`http://localhost:${srv.port}/api/auth/dev`, { method: 'POST' })).status).toBe(404);
  });
});

describe('负载：2 / 4 / 6 人牌局', () => {
  for (const n of [2, 4, 6]) {
    it(`${n} 人牌局：只同步牌局事件，流量与内存很小`, { timeout: 40000 }, async () => {
      const mem0 = process.memoryUsage().heapUsed;
      const cpu0 = process.cpuUsage();
      const { ps } = await table(n, 1000);
      // 所有人一直跟注 / 过牌，打 4 手
      const iv = setInterval(() => {
        for (const p of ps) {
          const v = p.view;
          if (v?.legal && v.currentPlayerId === p.playerId) p.send({ t: 'action', action: { type: v.legal.canCheck ? 'check' : 'call' } });
        }
      }, 20);
      await until(() => ps[0].view!.handNumber >= 5 || !!ps[0].view!.gameOver, 30000);
      clearInterval(iv);
      const hands = Math.min(4, ps[0].view!.handNumber - 1) || 1;
      const kbPerPlayerPerHand = ps.reduce((s, p) => s + p.bytes, 0) / n / hands / 1024;
      const cpuMs = (process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000;
      const memMb = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
      console.log(`${n} 人：每人每手约 ${kbPerPlayerPerHand.toFixed(1)} KB，CPU ${cpuMs.toFixed(0)} ms（含测试客户端），堆内存变化 ${memMb.toFixed(1)} MB`);
      // 只同步事件和每位玩家的视图：每人每手远小于 1 MB
      // 实测（所有人跟到摊牌的最坏情况）：2 人约 22 KB、4 人约 47 KB、6 人约 80 KB；设上限防止以后退化
      expect(kbPerPlayerPerHand).toBeLessThan(110);
      for (const p of ps) p.close();
    });
  }
});

import { inAllowList } from '../server/origins';

describe('网页与服务器分开部署（Vercel + Render）', () => {
  it('允许列表：精确网址与通配子域名', () => {
    const list = ['https://animal-poker.vercel.app', 'https://*.preview.example.com'];
    expect(inAllowList('https://animal-poker.vercel.app', list)).toBe(true);
    expect(inAllowList('https://evil.vercel.app', list)).toBe(false);
    expect(inAllowList('http://animal-poker.vercel.app', list)).toBe(false);
    expect(inAllowList('https://pr-12.preview.example.com', list)).toBe(true);
    expect(inAllowList('https://preview.example.com.evil.io', list)).toBe(false);
    expect(inAllowList('not a url', list)).toBe(false);
  });

  it('设置允许列表后：允许的网页可以连接并读取配置，其他网站被拒绝', async () => {
    const prev = process.env.APC_ALLOWED_ORIGINS;
    process.env.APC_ALLOWED_ORIGINS = 'https://animal-poker.vercel.app';
    try {
      const open = (origin: string) =>
        new Promise<'open' | 'closed'>((resolve) => {
          const ws = new WebSocket(`ws://localhost:${srv.port}/ws`, { headers: { origin } });
          ws.on('message', () => {
            ws.close();
            resolve('open');
          });
          ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', profile: { name: '测试', animal: DEFAULT_ANIMAL } })));
          ws.on('close', () => resolve('closed'));
          ws.on('error', () => resolve('closed'));
        });
      expect(await open('https://animal-poker.vercel.app')).toBe('open');
      expect(await open('https://evil.example')).toBe('closed');
      const ok = await fetch(`http://localhost:${srv.port}/api/auth/config`, { headers: { origin: 'https://animal-poker.vercel.app' } });
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://animal-poker.vercel.app');
      const bad = await fetch(`http://localhost:${srv.port}/api/auth/config`, { headers: { origin: 'https://evil.example' } });
      expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.APC_ALLOWED_ORIGINS;
      else process.env.APC_ALLOWED_ORIGINS = prev;
    }
  });
});
