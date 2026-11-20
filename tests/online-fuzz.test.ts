// 在线压力测试：4 个真实 WebSocket 客户端随机操作 + 随机断线重连，验证同步与安全
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import type { ServerMessage, RoomInfo } from '../src/core/protocol';
import type { TableView } from '../src/core/game/view';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import { seededRandom } from '../src/core/utils/random';

let srv: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  srv = await createServer(0, { pace: 0.03, turnTimeMs: 1500, lobbyGraceMs: 60000 });
});
afterAll(async () => {
  await srv.close();
});

class Bot {
  ws!: WebSocket;
  sessionId = '';
  playerId = '';
  room: RoomInfo | null = null;
  view: TableView | null = null;
  views: TableView[] = [];
  errors: string[] = [];
  constructor(public name: string) {}
  async connect(sessionId?: string) {
    this.ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.t === 'welcome') {
        this.sessionId = m.sessionId;
        this.playerId = m.playerId;
      }
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'state') {
        this.view = m.view;
        this.views.push(m.view);
      }
      if (m.t === 'error') this.errors.push(m.message);
    });
    await new Promise<void>((r) => this.ws.on('open', () => r()));
    this.send({ t: 'hello', sessionId, profile: { name: this.name, animal: DEFAULT_ANIMAL } });
    await until(() => !!this.playerId);
  }
  send(m: any) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}

async function until(cond: () => boolean, ms = 8000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('在线压力测试', () => {
  it('4 名玩家随机操作 + 断线重连，打满 12 手：状态一致、筹码守恒、底牌不泄露', async () => {
    const rng = seededRandom(42);
    const bots = [new Bot('甲'), new Bot('乙'), new Bot('丙'), new Bot('丁')];
    for (const b of bots) await b.connect();
    bots[0].send({ t: 'createRoom', settings: { maxPlayers: 5, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => !!bots[0].room);
    const code = bots[0].room!.code;
    for (const b of bots.slice(1)) b.send({ t: 'joinRoom', code });
    bots[0].send({ t: 'addAI', personality: 'crazyFrog', difficulty: 'hard' });
    await until(() => bots[0].room!.members.length === 5);
    for (const b of bots.slice(1)) b.send({ t: 'ready', ready: true });
    await until(() => bots[0].room!.members.every((m) => m.ready));
    bots[0].send({ t: 'startGame' });
    await until(() => bots.every((b) => b.view && b.view.handNumber >= 1));

    const TOTAL = 5000;
    let reconnects = 0;
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const v = bots[0].view!;
      if (v.gameOver || v.handNumber >= 12) break;
      for (const b of bots) {
        const bv = b.view;
        if (!bv || !bv.legal || b.ws.readyState !== WebSocket.OPEN) continue;
        const l = bv.legal;
        const r = rng();
        if (r < 0.04) {
          // 随机断线，稍后用同一个会话重连
          const sid = b.sessionId;
          b.ws.close();
          reconnects++;
          setTimeout(() => b.connect(sid), 300);
          continue;
        }
        if (r < 0.15) b.send({ t: 'action', action: { type: 'fold' } });
        else if (r < 0.3 && l.canRaise) b.send({ t: 'action', action: { type: 'raise', amount: l.minRaiseTo } });
        else if (r < 0.33 && l.canAllIn) b.send({ t: 'action', action: { type: 'allin' } });
        else b.send({ t: 'action', action: { type: l.canCheck ? 'check' : 'call' } });
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    await until(() => bots.every((b) => b.ws.readyState === WebSocket.OPEN && !!b.view), 5000);
    await new Promise((r) => setTimeout(r, 300));

    expect(bots[0].view!.handNumber).toBeGreaterThanOrEqual(6);
    expect(reconnects).toBeGreaterThan(0);

    // 1. 每个状态快照中筹码守恒
    for (const b of bots) {
      for (const v of b.views) {
        const sum = v.players.reduce((s, p) => s + p.chips + (v.phase !== 'complete' && v.phase !== 'idle' ? p.totalBet : 0), 0);
        expect(sum).toBe(TOTAL);
      }
    }
    // 2. 摊牌前永远看不到别人的底牌
    for (const b of bots) {
      for (const v of b.views) {
        if (v.phase === 'showdown' || v.phase === 'complete') continue;
        for (const p of v.players) {
          if (p.id === b.playerId) continue;
          expect(p.hole.every((c) => c === null)).toBe(true);
        }
      }
    }
    // 3. 最终所有客户端看到相同的公共状态
    const pub = (v: TableView) =>
      JSON.stringify({ h: v.handNumber, board: v.board.map((c) => c.id), chips: v.players.map((p) => p.chips), pot: v.potTotal, cur: v.currentPlayerId });
    await until(() => new Set(bots.map((b) => pub(b.view!))).size === 1, 4000);
    // 4. 重连后玩家仍在同一个房间
    for (const b of bots) expect(b.room?.code).toBe(code);

    for (const b of bots) b.ws.close();
  }, 70000);
});
