// Vercel 函数入口：/api/ws 实时连接（由 scripts/build-api.mjs 打包成 api/ws.js）
// Vercel 上同一时间可能有多个函数实例，所以房间状态保存在 Redis（Vercel 应用市场的 Upstash Redis 免费额度即可）。
import http from 'node:http';
import { Redis } from 'ioredis';
import { RoomServer } from './rooms';
import { attachGameSockets } from './gameServer';
import { createRedisStore, redisUrlFromEnv } from './redisStore';
import { randomId } from '../src/core/utils/random';

const redisUrl = redisUrlFromEnv();
if (!redisUrl) {
  console.warn('[动物扑克俱乐部] 没有找到 REDIS_URL / KV_URL：房间只保存在单个函数实例的内存中，不同实例上的玩家会互相看不到。请在 Vercel 应用市场添加 Redis（Upstash 免费额度）。');
}

const store = redisUrl
  ? createRedisStore('vc-' + randomId(8), () => new Redis(redisUrl, { maxRetriesPerRequest: 3, enableAutoPipelining: true }))
  : undefined;

const rooms = new RoomServer({
  store,
  // Vercel 免费方案：单条连接最长 300 秒；客户端会在到期前无缝换一条新连接
  maxConnectionMs: Number(process.env.APC_MAX_CONN_MS ?? 300_000),
});

const server = http.createServer((_req, res) => {
  res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('🐾 动物扑克俱乐部实时连接：请使用 WebSocket 连接本地址。');
});
attachGameSockets(server, { rooms });

export default server;
