// WebSocket 接入层：把浏览器连接接到房间系统。
// 本地服务器（server/index.ts）与 Vercel 函数（api/ws.ts）共用这一份代码。
import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { RoomServer } from './rooms';
import { RateLimiter } from './rateLimit';
import { inAllowList, isSameSite, originAllowed } from './origins';

/** 实时连接的路径：/api/ws（Vercel 函数的路径；本地服务器也提供），/ws 为旧版兼容 */
export const WS_PATHS = ['/api/ws', '/ws'];

export interface AttachOptions {
  rooms: RoomServer;
  /** 根据请求解析已登录玩家（仅本地完整服务器开启账号系统时提供） */
  resolveUser?: (req: http.IncomingMessage) => string | null;
  /** 每个 IP 的并发连接上限与每分钟新建连接上限（同一网络下的多名玩家共用一个 IP） */
  connLimits?: { perIp?: number; perMinute?: number };
}

export function attachGameSockets(server: http.Server, o: AttachOptions) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const ipConns = new Map<string, number>();
  const maxConnsPerIp = o.connLimits?.perIp ?? 20;
  const ipConnects = new RateLimiter(o.connLimits?.perMinute ?? 60, 60_000);

  server.on('upgrade', (req, socket, head) => {
    let path = '';
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      // 格式错误的网址（例如 “//”）：只拒绝这一条连接。以前这里的异常没有人接，会让整个服务器（所有房间）崩溃
    }
    if (!WS_PATHS.includes(path)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    // 必须最先监听：连接被拒绝（人数 / 来源）后、真正关闭前收到坏数据也会触发 error，没有监听会让整个服务器崩溃
    ws.on('error', () => undefined);
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    const open = ipConns.get(ip) ?? 0;
    if (open >= maxConnsPerIp || !ipConnects.allow(ip)) {
      ws.close(1013, 'too many connections');
      return;
    }
    ipConns.set(ip, open + 1);
    ws.on('close', () => {
      const n = (ipConns.get(ip) ?? 1) - 1;
      if (n <= 0) ipConns.delete(ip);
      else ipConns.set(ip, n);
    });
    // 只允许本站或允许列表中的网页连接（APC_ALLOWED_ORIGINS）
    if (!originAllowed(req)) {
      ws.close(1008, 'origin not allowed');
      return;
    }
    // 只有来自同一个网站的连接才会带上登录身份（防止跨站 WebSocket 冒用 Cookie）
    const origin = req.headers.origin;
    const sameSite = !origin || isSameSite(req, origin) || inAllowList(origin);
    let userId: string | null = null;
    try {
      userId = sameSite && o.resolveUser ? o.resolveUser(req) : null;
    } catch {
      userId = null;
    }
    let alive = true;
    const handler = o.rooms.connect(
      {
        send: (msg) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        },
        close: () => ws.close(),
      },
      { userId },
    );
    ws.on('message', (data) => handler.onMessage(data.toString()));
    ws.on('pong', () => (alive = true));
    let closed = false;
    const onClose = () => {
      if (closed) return;
      closed = true;
      clearInterval(hb);
      handler.onClose();
    };
    ws.on('close', onClose);
    ws.on('error', onClose);
    const hb = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }, 15000);
  });

  return wss;
}
