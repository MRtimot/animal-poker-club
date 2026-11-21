// 动物扑克俱乐部 · 自建轻量服务器（HTTP 静态文件 + WebSocket），无任何第三方服务
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomServer, type RoomServerOptions } from './rooms';
import { openDatabase } from './db/database';
import { AccountService } from './account/accounts';
import { SessionStore, SESSION_COOKIE, parseCookies } from './auth/sessions';
import { GoogleVerifier, type GoogleVerifierOptions } from './auth/google';
import { createApi } from './api';

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

export interface ServerOptions extends Omit<RoomServerOptions, 'accounts'> {
  /** SQLite 数据库文件路径；':memory:' 用于测试 */
  dbPath?: string;
  /** Google OAuth 客户端 ID（公开值，不是密钥）；不提供则不显示 Google 登录 */
  google?: GoogleVerifierOptions | null;
  devLogin?: boolean;
  production?: boolean;
}

export function createServer(port: number, opts: ServerOptions = {}) {
  const production = opts.production ?? process.env.NODE_ENV === 'production';
  const dbPath = opts.dbPath ?? process.env.APC_DB_PATH ?? (process.env.VITEST ? ':memory:' : path.resolve(__dirname, '../data/apc.sqlite'));
  const db = openDatabase(dbPath);
  const accounts = new AccountService(db);
  const sessions = new SessionStore(db);
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const google = opts.google !== undefined ? (opts.google ? new GoogleVerifier(opts.google) : null) : clientId ? new GoogleVerifier({ clientId }) : null;
  // 测试登录只在开发环境且明确开启时可用，正式环境永远关闭
  const devLogin = !production && (opts.devLogin ?? process.env.APC_DEV_LOGIN === '1');
  const rooms = new RoomServer({ ...opts, accounts });
  const api = createApi({
    accounts,
    sessions,
    google,
    devLogin,
    production,
    onAccountChanged: (userId, state) => rooms.notifyAccount(userId, state),
    onAccountDeleted: (userId) => {
      rooms.dropUser(userId);
      sessions.revokeAll(userId);
    },
  });
  const sessionSweep = setInterval(() => sessions.sweep(), 3600_000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      await api(req, res);
      return;
    }
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
  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    let alive = true;
    // 只有来自本站页面的连接才会带上登录身份（防止跨站 WebSocket 冒用 Cookie）
    const origin = req.headers.origin;
    let sameSite = true;
    if (origin) {
      try {
        sameSite = new URL(origin).host === req.headers.host || (process.env.APC_ALLOWED_ORIGINS ?? '').split(',').includes(origin);
      } catch {
        sameSite = false;
      }
    }
    let userId: string | null = null;
    try {
      userId = sameSite ? sessions.resolve(parseCookies(req.headers.cookie)[SESSION_COOKIE]) : null;
    } catch {
      userId = null;
    }
    const handler = rooms.connect({
      send: (msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(),
    }, { userId });
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

  return new Promise<{ close: () => Promise<void>; port: number; rooms: RoomServer; accounts: AccountService }>((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const realPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: realPort,
        rooms,
        accounts,
        close: () =>
          new Promise<void>((r) => {
            rooms.dispose();
            clearInterval(sessionSweep);
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.close(() => {
              db.close();
              r();
            });
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
    if (!process.env.GOOGLE_CLIENT_ID) console.log('ℹ️  未设置 GOOGLE_CLIENT_ID：Google 登录不可用，玩家可以游客身份游玩。');
  });
}
