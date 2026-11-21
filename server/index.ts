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
import { RateLimiter } from './rateLimit';

const MAX_CONNS_PER_IP = 12;

/** 未开启账号系统时的接口：只告诉前端“没有登录功能”，其他一律 404 */
async function guestOnlyApi(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ok = req.method === 'GET' && url.pathname === '/api/auth/config';
  res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(ok ? { googleClientId: null, devLogin: false, accounts: false } : { error: '接口不存在' }));
  return true;
}

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
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const google = opts.google !== undefined ? (opts.google ? new GoogleVerifier(opts.google) : null) : clientId ? new GoogleVerifier({ clientId }) : null;
  // 测试登录只在开发环境且明确开启时可用，正式环境永远关闭
  const devLogin = !production && (opts.devLogin ?? process.env.APC_DEV_LOGIN === '1');
  // 账号系统是可选模块：没有配置 Google 登录时完全不打开数据库（RM0：不需要任何持久化存储）
  const accountsEnabled = !!google || devLogin;
  let db: ReturnType<typeof openDatabase> | null = null;
  let accounts: AccountService | null = null;
  let sessions: SessionStore | null = null;
  if (accountsEnabled) {
    const dbPath = opts.dbPath ?? process.env.APC_DB_PATH ?? (process.env.VITEST ? ':memory:' : path.resolve(__dirname, '../data/apc.sqlite'));
    db = openDatabase(dbPath);
    accounts = new AccountService(db);
    sessions = new SessionStore(db);
  }
  const rooms = new RoomServer({ ...opts, accounts });
  const api =
    accounts && sessions
      ? createApi({
          accounts,
          sessions,
          google,
          devLogin,
          production,
          onAccountChanged: (userId, state) => rooms.notifyAccount(userId, state),
          onAccountDeleted: (userId) => {
            rooms.dropUser(userId);
            sessions!.revokeAll(userId);
          },
        })
      : guestOnlyApi;
  const sessionSweep = setInterval(() => sessions?.sweep(), 3600_000);
  // 每个 IP 的并发连接数与新建连接频率（防止恶意刷连接）
  const ipConns = new Map<string, number>();
  const ipConnects = new RateLimiter(30, 60_000);

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
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    const open = ipConns.get(ip) ?? 0;
    if (open >= MAX_CONNS_PER_IP || !ipConnects.allow(ip)) {
      ws.close(1013, 'too many connections');
      return;
    }
    ipConns.set(ip, open + 1);
    ws.on('close', () => {
      const n = (ipConns.get(ip) ?? 1) - 1;
      if (n <= 0) ipConns.delete(ip);
      else ipConns.set(ip, n);
    });
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
      userId = sameSite && sessions ? sessions.resolve(parseCookies(req.headers.cookie)[SESSION_COOKIE]) : null;
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

  return new Promise<{ close: () => Promise<void>; port: number; rooms: RoomServer; accounts: AccountService | null }>((resolve) => {
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
              db?.close();
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
  createServer(port).then(({ port: p, rooms, close }) => {
    console.log(`🐾 动物扑克俱乐部服务器已启动：http://localhost:${p}  （WebSocket: /ws）`);
    if (!process.env.GOOGLE_CLIENT_ID) console.log('ℹ️  未设置 GOOGLE_CLIENT_ID：游客模式（不使用数据库，玩家进度保存在各自浏览器中）。');
    // 部署 / 重启时：先通知在线玩家，再关闭（房间只在服务器运行期间存在）
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      rooms.notifyShutdown();
      setTimeout(() => close().finally(() => process.exit(0)), 500);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });
}
