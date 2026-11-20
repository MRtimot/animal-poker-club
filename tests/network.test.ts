import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import type { ServerMessage, RoomInfo } from '../src/core/protocol';
import type { TableView } from '../src/core/game/view';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import { GameController } from '../src/core/game/controller';

let srv: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  srv = await createServer(0, { pace: 0.02, turnTimeMs: 400, lobbyGraceMs: 300 });
});
afterAll(async () => {
  await srv.close();
});

class TestClient {
  ws!: WebSocket;
  msgs: ServerMessage[] = [];
  sessionId = '';
  playerId = '';
  room: RoomInfo | null = null;
  view: TableView | null = null;
  errors: string[] = [];

  constructor(public name: string) {}

  async connect(sessionId?: string) {
    this.ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      if (m.t === 'welcome') {
        this.sessionId = m.sessionId;
        this.playerId = m.playerId;
      }
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'state') this.view = m.view;
      if (m.t === 'error') this.errors.push(m.message);
    });
    await new Promise<void>((r) => this.ws.on('open', () => r()));
    this.send({ t: 'hello', sessionId, profile: { name: this.name, animal: DEFAULT_ANIMAL } });
    await this.until(() => !!this.playerId);
  }

  send(m: any) {
    this.ws.send(JSON.stringify(m));
  }

  async until(cond: () => boolean, ms = 4000) {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error(`等待超时：${this.name}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  close() {
    this.ws.close();
  }
}

describe('在线房间', () => {
  it('创建房间、加入房间、准备、开始游戏并同步状态', async () => {
    const a = new TestClient('玩家A');
    const b = new TestClient('玩家B');
    const c = new TestClient('玩家C');
    await a.connect();
    await b.connect();
    await c.connect();

    a.send({ t: 'createRoom', settings: { maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await a.until(() => !!a.room);
    const code = a.room!.code;
    expect(code).toMatch(/^[A-Z0-9]{5}$/);

    b.send({ t: 'joinRoom', code: code.toLowerCase() });
    c.send({ t: 'joinRoom', code });
    await a.until(() => a.room!.members.length === 3);
    expect(a.room!.hostId).toBe(a.playerId);

    // 未准备不能开始
    a.send({ t: 'startGame' });
    await a.until(() => a.errors.length > 0);
    expect(a.errors[0]).toContain('没有准备');

    // 非房主不能开始
    b.send({ t: 'startGame' });
    await b.until(() => b.errors.length > 0);
    expect(b.errors[0]).toContain('房主');

    b.send({ t: 'ready', ready: true });
    c.send({ t: 'ready', ready: true });
    await a.until(() => a.room!.members.every((m) => m.ready));
    a.send({ t: 'startGame' });
    await a.until(() => !!a.view && a.view.handNumber === 1 && a.view.phase === 'preflop');
    await b.until(() => !!b.view && b.view.handNumber === 1);
    await c.until(() => !!c.view && c.view.handNumber === 1);

    // 每个人只能看到自己的底牌
    const meA = a.view!.players.find((p) => p.id === a.playerId)!;
    const bInA = a.view!.players.find((p) => p.id === b.playerId)!;
    expect(meA.hole.every((x) => x !== null)).toBe(true);
    expect(bInA.hole.every((x) => x === null)).toBe(true);
    const bHole = b.view!.players.find((p) => p.id === b.playerId)!.hole.map((x) => x!.id);
    // 翻牌前 A 收到的所有状态消息中都不应包含 B 的底牌
    const preflopJson = JSON.stringify(a.msgs.filter((m) => m.t === 'state' && m.view.handNumber === 1 && m.view.phase === 'preflop'));
    for (const id of bHole) expect(preflopJson.includes(`"id":"${id}"`)).toBe(false);

    // 轮到的人执行操作，其他人同步看到
    const clients = [a, b, c];
    const curId = a.view!.currentPlayerId!;
    const cur = clients.find((x) => x.playerId === curId)!;
    const other = clients.find((x) => x.playerId !== curId)!;
    // 不该行动的玩家行动 → 被服务器拒绝
    other.send({ t: 'action', action: { type: 'call' } });
    await other.until(() => other.errors.some((e) => e.includes('轮到')));
    cur.send({ t: 'action', action: { type: 'call' } });
    await a.until(() => a.view!.players.find((p) => p.id === curId)!.lastAction?.type === 'call');
    await b.until(() => b.view!.players.find((p) => p.id === curId)!.lastAction?.type === 'call');

    // 聊天与表情同步
    b.send({ t: 'chat', text: '你在诈我吧？' });
    b.send({ t: 'emote', emoji: '😂' });
    await c.until(() => c.msgs.some((m) => m.t === 'chat' && m.message.text === '😂' && m.message.kind === 'emote'));
    expect(c.msgs.some((m) => m.t === 'chat' && m.message.text === '你在诈我吧？')).toBe(true);

    // 断线 → 重连后回到同一房间并拿到当前状态
    const bSession = b.sessionId;
    const bId = b.playerId;
    b.close();
    await a.until(() => a.room!.members.find((m) => m.id === bId)!.connected === false);
    const b2 = new TestClient('玩家B');
    await b2.connect(bSession);
    expect(b2.playerId).toBe(bId);
    await b2.until(() => !!b2.room && !!b2.view);
    expect(b2.room!.code).toBe(code);
    expect(b2.view!.players.find((p) => p.id === bId)!.hole.every((x) => x !== null)).toBe(true);
    await a.until(() => a.room!.members.find((m) => m.id === bId)!.connected === true);

    // 超时自动行动让牌局继续推进（服务器权威计时）
    await a.until(() => a.view!.handNumber >= 2, 15000);

    // 退出房间
    c.send({ t: 'leaveRoom' });
    await c.until(() => c.room === null);
    await a.until(() => a.room!.members.length === 2);

    a.close();
    b2.close();
    c.close();
  }, 30000);

  it('房间不存在 / 房间已满 / 添加 AI', async () => {
    const a = new TestClient('房主');
    const b = new TestClient('路人');
    const c = new TestClient('迟到');
    await a.connect();
    await b.connect();
    await c.connect();
    b.send({ t: 'joinRoom', code: 'ZZZZZ' });
    await b.until(() => b.errors.length > 0);
    expect(b.errors[0]).toContain('不存在');

    a.send({ t: 'createRoom', settings: { maxPlayers: 2, startingChips: 5000, smallBlind: 25, bigBlind: 50, turnSeconds: 30 } });
    await a.until(() => !!a.room);
    expect(a.room!.settings.startingChips).toBe(5000);
    a.send({ t: 'addAI', personality: 'aggressiveFox', difficulty: 'hard' });
    await a.until(() => a.room!.members.length === 2);
    expect(a.room!.members[1].isAI).toBe(true);
    b.send({ t: 'joinRoom', code: a.room!.code });
    await b.until(() => b.errors.length > 1);
    expect(b.errors[1]).toContain('已满');

    // 与 AI 开始游戏，AI 会自动行动
    a.send({ t: 'startGame' });
    await a.until(() => !!a.view && a.view.handNumber >= 1);
    await a.until(() => a.view!.events.some((e) => e.type === 'action'), 8000);

    // 房主离开 → 房间销毁
    const code = a.room!.code;
    a.send({ t: 'leaveRoom' });
    await a.until(() => a.room === null);
    expect(srv.rooms.getRoom(code)).toBeUndefined();
    a.close();
    b.close();
    c.close();
  }, 20000);

  it('房主断线后离开，房主自动转移', async () => {
    const a = new TestClient('甲');
    const b = new TestClient('乙');
    await a.connect();
    await b.connect();
    a.send({ t: 'createRoom', settings: { maxPlayers: 3, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await a.until(() => !!a.room);
    b.send({ t: 'joinRoom', code: a.room!.code });
    await b.until(() => b.room?.members.length === 2);
    a.send({ t: 'leaveRoom' });
    await b.until(() => b.room!.hostId === b.playerId && b.room!.members.length === 1);
    a.close();
    b.close();
  });
});

describe('游戏控制器', () => {
  it('全 AI 牌桌可以自动完整地打完一整场', async () => {
    const seats = ['aggressiveFox', 'cautiousPanda', 'crazyFrog', 'smartCat', 'luckyRabbit'].map((p, i) => ({
      id: 'ai' + i,
      profile: { name: 'AI' + i, animal: DEFAULT_ANIMAL },
      chips: 300,
      isAI: true,
      aiPersonality: p as any,
      aiDifficulty: 'easy' as const,
    }));
    // 加一个“人类”使游戏不因无人类而提前结束：其行动由超时自动完成
    seats.push({ id: 'h', profile: { name: '人', animal: DEFAULT_ANIMAL }, chips: 300, isAI: false } as any);
    const c = new GameController(seats, { smallBlind: 10, bigBlind: 20, pace: 0, turnTimeMs: 0, offlineTurnMs: 0 });
    c.start();
    const start = Date.now();
    while (!c.isGameOver() && Date.now() - start < 15000) await new Promise((r) => setTimeout(r, 5));
    const total = c.engine.players.reduce((s, p) => s + p.chips, 0);
    expect(total).toBe(1800);
    expect(c.engine.handNumber).toBeGreaterThan(1);
    c.stop();
  }, 20000);
});
