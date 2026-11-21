// Bug 审计回归测试：每一项对应一个已修复的问题或一个必须保持的行为
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import { MemoryHub } from '../server/store';
import { PokerEngine } from '../src/core/table/engine';
import { cleanGuestSave, useProfile } from '../src/store/profileStore';
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

class P {
  ws!: WebSocket;
  msgs: ServerMessage[] = [];
  sessionId = '';
  playerId = '';
  room: RoomInfo | null = null;
  view: TableView | null = null;
  errors: string[] = [];
  constructor(public name: string) {}
  async connect(port: number, sessionId?: string) {
    this.ws = new WebSocket(`ws://localhost:${port}/api/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      if (m.t === 'welcome') {
        this.sessionId = m.sessionId;
        this.playerId = m.playerId;
      }
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'state' && !m.view.eventsDelta) this.view = m.view;
      if (m.t === 'state' && m.view.eventsDelta && this.view) this.view = { ...m.view, players: m.view.players.map((p) => (p.profile ? p : { ...p, profile: this.view!.players.find((x) => x.id === p.id)!.profile })) };
      if (m.t === 'error') this.errors.push(m.message);
    });
    await new Promise<void>((r) => this.ws.on('open', () => r()));
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

const settings = { maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 };
let srv: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  srv = await createServer(0, { pace: 0.02, turnTimeMs: 2000, connLimits: { perIp: 1000, perMinute: 10000 } });
});
afterAll(async () => {
  await srv.close();
});

describe('扑克引擎：非法金额', () => {
  it('NaN / Infinity / 负数 / 0 的加注被拒绝，筹码不会变成 NaN；小数向下取整', () => {
    const e = new PokerEngine({ smallBlind: 10, bigBlind: 20 });
    e.addPlayer('a', 'A', 1000, 0);
    e.addPlayer('b', 'B', 1000, 1);
    e.addPlayer('c', 'C', 1000, 2);
    e.startHand();
    const id = e.currentPlayer!.id;
    for (const amount of [NaN, Infinity, -Infinity, -50, 0, undefined, '100' as any]) {
      expect(() => e.act(id, { type: 'raise', amount })).toThrow();
      expect(e.currentPlayer!.id).toBe(id);
    }
    for (const p of e.players) {
      expect(Number.isFinite(p.chips)).toBe(true);
      expect(Number.isFinite(p.bet)).toBe(true);
    }
    e.act(id, { type: 'raise', amount: 45.7 });
    expect(e.getPlayer(id)!.bet).toBe(45);
  });
});

describe('服务器稳定性', () => {
  it('格式错误的网址不会让服务器崩溃', async () => {
    const r = await fetch(`http://localhost:${srv.port}/%E0%A4%A`);
    expect(r.status).toBe(400);
    expect((await fetch(`http://localhost:${srv.port}/health`)).status).toBe(200);
  });
});

describe('房间', () => {
  it('错误 / 非法的房间代码：提示“房间不存在”，不会出现 undefined', async () => {
    const p = new P('甲');
    await p.connect(srv.port);
    for (const code of ['ABC999', '', 'x'.repeat(500), '<script>', 123, null]) p.send({ t: 'joinRoom', code });
    await until(() => p.errors.length >= 6);
    expect(p.errors.every((e) => e === '房间不存在，请检查房间代码')).toBe(true);
    p.close();
  });

  it('1 → 6 人依次加入，第 7 人提示“房间已满”', async () => {
    const ps = Array.from({ length: 7 }, (_, i) => new P('玩家' + (i + 1)));
    for (const p of ps) await p.connect(srv.port);
    ps[0].send({ t: 'createRoom', settings });
    await until(() => !!ps[0].room);
    const code = ps[0].room!.code;
    for (let i = 1; i < 6; i++) {
      ps[i].send({ t: 'joinRoom', code });
      await until(() => ps[0].room!.members.length === i + 1);
    }
    ps[6].send({ t: 'joinRoom', code });
    await until(() => ps[6].errors.length > 0);
    expect(ps[6].errors[0]).toBe('房间已满');
    expect(ps[6].room).toBeNull();
    expect(ps[0].room!.members).toHaveLength(6);
    for (const p of ps) p.close();
  });

  it('已经在房间里再次加入：收到房间信息，不会出现重复玩家', async () => {
    const a = new P('Tomato');
    const b = new P('Alex');
    await a.connect(srv.port);
    await b.connect(srv.port);
    a.send({ t: 'createRoom', settings });
    await until(() => !!a.room);
    const code = a.room!.code;
    b.send({ t: 'joinRoom', code });
    await until(() => a.room!.members.length === 2 && !!b.room);
    // 客户端丢失了房间状态（例如界面被重置），再次输入同一个代码
    b.room = null;
    b.send({ t: 'joinRoom', code });
    b.send({ t: 'joinRoom', code });
    await until(() => !!b.room);
    expect(b.room!.code).toBe(code);
    await new Promise((r) => setTimeout(r, 100));
    expect(a.room!.members.filter((m) => m.profile.name === 'Alex')).toHaveLength(1);
    a.close();
    b.close();
  });

  it('两台服务器上的两名玩家同时抢最后一个座位：只有一人成功', async () => {
    const hub = new MemoryHub();
    const opts = { connLimits: { perIp: 1000, perMinute: 10000 } };
    const s1 = await createServer(0, { ...opts, store: hub.store('i1') });
    const s2 = await createServer(0, { ...opts, store: hub.store('i2') });
    try {
      const host = new P('房主');
      await host.connect(s1.port);
      host.send({ t: 'createRoom', settings: { ...settings, maxPlayers: 2 } });
      await until(() => !!host.room);
      const x = new P('抢座甲');
      const y = new P('抢座乙');
      await x.connect(s1.port);
      await y.connect(s2.port);
      x.send({ t: 'joinRoom', code: host.room!.code });
      y.send({ t: 'joinRoom', code: host.room!.code });
      await until(() => (!!x.room || x.errors.length > 0) && (!!y.room || y.errors.length > 0));
      expect([!!x.room, !!y.room].filter(Boolean)).toHaveLength(1);
      expect([...x.errors, ...y.errors]).toContain('房间已满');
      await new Promise((r) => setTimeout(r, 100));
      expect(host.room!.members).toHaveLength(2);
      for (const p of [host, x, y]) p.close();
    } finally {
      await s1.close();
      await s2.close();
    }
  });

  it('房主连续点击“开始游戏”：只开始一局；非房主不能开始', async () => {
    const a = new P('Tomato');
    const b = new P('Alex');
    await a.connect(srv.port);
    await b.connect(srv.port);
    a.send({ t: 'createRoom', settings });
    await until(() => !!a.room);
    b.send({ t: 'joinRoom', code: a.room!.code });
    await until(() => a.room!.members.length === 2);
    b.send({ t: 'startGame' });
    await until(() => b.errors.includes('只有房主可以开始游戏'));
    b.send({ t: 'ready', ready: true });
    await until(() => a.room!.members.every((m) => m.ready));
    for (let i = 0; i < 4; i++) a.send({ t: 'startGame' });
    await until(() => !!a.view && !!b.view);
    await new Promise((r) => setTimeout(r, 200));
    const rec = srv.rooms.getRoom(a.room!.code) as any;
    expect(rec.gameSeq).toBe(1);
    expect(a.room!.status).toBe('playing');
    // 双方在同一手牌、同一个底池
    expect(a.view!.handNumber).toBe(b.view!.handNumber);
    a.close();
    b.close();
  });
});

describe('本机存档：损坏 / 旧版本 / 非法值', () => {
  it('不存在的动物、非法数值、缺失字段都会被修正，不会让界面崩溃', () => {
    const cur = useProfile.getState();
    const out = cleanGuestSave(
      {
        name: 123,
        animal: { species: 'unicorn', hat: 'laser' },
        characters: [{ id: 'ok', name: '<b>x</b>', animal: { species: 'dragon' } }, null, 'bad', { id: 5 }],
        xp: 'lots',
        stats: { handsPlayed: -3, handsWon: 'x' },
        achievements: { first_win: 1, fake: 9, royal: 'yes' },
        recent: [{ place: 0, players: 1 }, 7],
      },
      cur,
    );
    expect(out.name).toBe(cur.name);
    expect(out.animal!.species).toBe('cat');
    expect(out.animal!.hat).toBe('none');
    expect(out.characters).toHaveLength(1);
    expect(out.characters![0].name).not.toContain('<');
    expect(out.xp).toBe(0);
    expect(out.stats!.folds).toBe(0);
    expect(out.achievements).toEqual({ first_win: 1 });
    expect(out.recent![0].place).toBe(1);
    expect(out.recent![0].players).toBe(2);
    // 完全损坏的存档：使用默认值
    const empty = cleanGuestSave('not an object', cur);
    expect(empty.animal!.species).toBe('cat');
    expect(empty.characters).toEqual([]);
  });
});
