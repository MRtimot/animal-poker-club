// 动物扑克俱乐部 · 自建轻量服务器（HTTP 静态文件 + WebSocket），无任何第三方服务
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomServer } from './rooms';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

export function createServer(port: number, opts: ConstructorParameters<typeof RoomServer>[0] = {}) {
  const rooms = new RoomServer(opts);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.roomCount }));
      return;
    }
    if (!fs.existsSync(DIST)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('动物扑克俱乐部服务器运行中。开发模式请访问 Vite 地址（默认 http://localhost:5173）。');
      return;
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws: WebSocket) => {
    let alive = true;
    const handler = rooms.connect({
      send: (msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(),
    });
    ws.on('message', (data) => handler.onMessage(data.toString()));
    ws.on('pong', () => (alive = true));
    ws.on('close', () => handler.onClose());
    ws.on('error', () => handler.onClose());
    const hb = setInterval(() => {
      if (!alive) {
        ws.terminate();
        clearInterval(hb);
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }, 15000);
    ws.on('close', () => clearInterval(hb));
  });

  return new Promise<{ close: () => Promise<void>; port: number; rooms: RoomServer }>((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const realPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: realPort,
        rooms,
        close: () =>
          new Promise<void>((r) => {
            rooms.dispose();
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.close(() => r());
          }),
      });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 3001);
  createServer(port).then(({ port: p }) => {
    console.log(`🐾 动物扑克俱乐部服务器已启动：http://localhost:${p}  （WebSocket: /ws）`);
  });
}
