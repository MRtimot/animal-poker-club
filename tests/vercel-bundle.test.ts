// 测试打包好的 Vercel 函数（api/ws.js）：在独立的 Node 进程中运行，两个玩家通过 /api/ws 建房、加入、开始游戏
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import WebSocket from 'ws';
import type { ServerMessage, RoomInfo } from '../src/core/protocol';
import type { TableView } from '../src/core/game/view';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';

const root = path.resolve(__dirname, '..');
let proc: ChildProcess;
let port = 0;

beforeAll(async () => {
  // 先重新打包，保证测试的是最新代码
  execFileSync(process.execPath, ['scripts/build-api.mjs'], { cwd: root, stdio: 'ignore' });
  const runner = `import('./api/ws.js').then(({ default: server }) => server.listen(0, () => console.log('PORT=' + server.address().port)))`;
  proc = spawn(process.execPath, ['--input-type=module', '-e', runner], { cwd: root, env: { ...process.env, REDIS_URL: '', KV_URL: '' } });
  port = await new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('打包后的函数没有启动')), 15000);
    proc.stdout!.on('data', (d) => {
      const m = /PORT=(\d+)/.exec(d.toString());
      if (m) {
        clearTimeout(t);
        resolve(Number(m[1]));
      }
    });
    proc.on('exit', (code) => reject(new Error('进程退出：' + code)));
  });
}, 60000);

afterAll(() => {
  proc?.kill();
});

async function until(cond: () => boolean, ms = 8000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function client(name: string) {
  const c = {
    ws: new WebSocket(`ws://localhost:${port}/api/ws`),
    playerId: '',
    rotateInMs: 0,
    room: null as RoomInfo | null,
    view: null as TableView | null,
    send: (m: unknown) => c.ws.send(JSON.stringify(m)),
  };
  c.ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as ServerMessage;
    if (m.t === 'welcome') {
      c.playerId = m.playerId;
      c.rotateInMs = m.rotateInMs ?? 0;
    }
    if (m.t === 'room') c.room = m.room;
    if (m.t === 'state') c.view = m.view;
  });
  return new Promise<typeof c>((r) =>
    c.ws.on('open', () => {
      c.send({ t: 'hello', profile: { name, animal: DEFAULT_ANIMAL } });
      r(c);
    }),
  );
}

describe('Vercel 函数打包产物（api/ws.js）', () => {
  it('普通 HTTP 请求返回提示；WebSocket 建房 → 加入 → 开始游戏', async () => {
    const res = await fetch(`http://localhost:${port}/api/ws`);
    expect(res.status).toBe(426);
    const a = await client('Tomato');
    const b = await client('Alex');
    await until(() => !!a.playerId && !!b.playerId);
    expect(a.rotateInMs).toBe(300_000);
    a.send({ t: 'createRoom', settings: { maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => !!a.room);
    b.send({ t: 'joinRoom', code: a.room!.code });
    await until(() => a.room!.members.length === 2 && b.room?.members.length === 2);
    b.send({ t: 'ready', ready: true });
    await until(() => a.room!.members.every((m) => m.ready));
    a.send({ t: 'startGame' });
    await until(() => !!a.view && !!b.view && a.view.handNumber >= 1 && b.view.handNumber >= 1, 10000);
    expect(a.room!.status).toBe('playing');
    a.ws.close();
    b.ws.close();
  }, 30000);
});
