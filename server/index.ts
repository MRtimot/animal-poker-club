// 动物扑克俱乐部 · 自建轻量服务器（HTTP 静态文件 + WebSocket），无任何第三方服务
import http from 'node:http';
import { Redis } from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomServer, type RoomServerOptions } from './rooms';
import { openDatabase } from './db/database';
import { AccountService } from './account/accounts';
import { SessionStore, SESSION_COOKIE, parseCookies } from './auth/sessions';
import { GoogleVerifier, type GoogleVerifierOptions } from './auth/google';
import { createApi } from './api';
import { inAllowList, isSameSite } from './origins';
import { attachGameSockets } from './gameServer';
import { createRedisStore, redisUrlFromEnv } from './redisStore';
import { randomId } from '../src/core/utils/random';


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
  /** 每个 IP 的并发连接上限与每分钟新建连接上限（防刷连接；同一网络下的多名玩家共用一个 IP） */
  connLimits?: { perIp?: number; perMinute?: number };
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
  // 有 Redis（例如部署在 Vercel）时用 Redis 共享房间状态；否则房间保存在本进程内存中
  let store = opts.store;
  const redisUrl = redisUrlFromEnv();
  if (!store && redisUrl) {
    store = createRedisStore('srv-' + randomId(8), () => new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false }));
  }
  const rooms = new RoomServer({ ...opts, accounts, store });
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

  const server = http.createServer((req, res) => {
    // 任何请求出错都只影响这一个请求，绝不能让整个服务器（所有房间）崩溃
    handleRequest(req, res).catch((err) => {
      console.error('[服务器] 处理请求出错', err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('服务器暂时不可用');
    });
  });

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      // 网页在其他网址（例如 Vercel）时：允许它读取接口（只限允许列表，不带登录 Cookie）
      const origin = req.headers.origin;
      if (origin && !isSameSite(req, origin) && inAllowList(origin)) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' });
          res.end();
          return;
        }
      }
      await api(req, res);
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.roomCount }));
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      // 格式错误的网址（例如 /%E0%A4%A）：以前会让整个服务器崩溃
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('网址格式错误');
      return;
    }
    if (!fs.existsSync(DIST)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      // 只部署了游戏服务器（网页在 Vercel 等其他地方），或开发模式（网页由 Vite 提供）
      res.end('🐾 动物扑克俱乐部游戏服务器运行中。请打开网页的网址开始游戏。');
      return;
    }
    let file = path.join(DIST, decoded);
    // 只允许 dist 目录里的文件（同时防止 /dist-xxx 这类同名前缀目录）
    if (file !== DIST && !file.startsWith(DIST + path.sep)) {
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
    fs.createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  const wss = attachGameSockets(server, {
    rooms,
    connLimits: opts.connLimits,
    resolveUser: sessions ? (req) => sessions!.resolve(parseCookies(req.headers.cookie)[SESSION_COOKIE]) : undefined,
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
            if (store && store !== opts.store) void store.close();
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
    console.log(`🐾 动物扑克俱乐部服务器已启动：http://localhost:${p}  （WebSocket: /api/ws）`);
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
