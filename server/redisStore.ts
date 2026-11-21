// Redis 共享存储（用于 Vercel：多台函数实例共享房间状态）。
// 兼容任何标准 Redis，包括 Vercel 应用市场里的 Upstash Redis（免费额度）。
// 为了节省免费额度：每次修改房间只需要 1 条命令（Lua 脚本里完成“比较版本 → 写入 → 发布”）。
import type { Redis as RedisClient } from 'ioredis';
import type { SharedStore } from './store';

const ROOM = (code: string) => `apc:room:${code}`;
const VER = (code: string) => `apc:roomv:${code}`;
const CHANNEL = 'apc:events';

/** KEYS: room, version；ARGV: expected, next, json('' = 删除), ttlMs, channel, event */
const COMMIT_LUA = `
local cur = tonumber(redis.call('GET', KEYS[2]) or '0')
if cur ~= tonumber(ARGV[1]) then return 0 end
if ARGV[3] == '' then
  redis.call('DEL', KEYS[1], KEYS[2])
else
  redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
  redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[4])
end
redis.call('PUBLISH', ARGV[5], ARGV[6])
return 1
`;

/** 读取房间记录与版本号（1 条命令） */
const LOAD_LUA = `return { redis.call('GET', KEYS[1]), redis.call('GET', KEYS[2]) }`;

/**
 * Redis 连接地址。Vercel 应用市场的 Redis 集成会自动设置环境变量（名称因集成而异）：
 * 优先使用 REDIS_URL / KV_URL；只有 REST 地址和令牌时（Upstash），换算成标准 Redis 地址。
 */
export function redisUrlFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const direct = env.REDIS_URL || env.KV_URL || env.UPSTASH_REDIS_URL;
  if (direct) return direct;
  const rest = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (rest && token) {
    try {
      const host = new URL(rest).hostname;
      return `rediss://default:${encodeURIComponent(token)}@${host}:6379`;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param makeClient 创建 Redis 连接（测试时可注入模拟实现）；需要两条连接：命令 + 订阅
 */
export function createRedisStore(instanceId: string, makeClient: () => RedisClient): SharedStore {
  const cmd = makeClient();
  const sub = makeClient();
  let handler: ((e: string) => void) | null = null;
  let subscribed: Promise<unknown> | null = null;
  sub.on('message', (channel: string, message: string) => {
    if (channel === CHANNEL && handler) handler(message);
  });
  // Redis 连接错误只记录，不让进程崩溃（客户端会自动重连）
  cmd.on('error', (e: Error) => console.error('[Redis] 命令连接出错', e.message));
  sub.on('error', (e: Error) => console.error('[Redis] 订阅连接出错', e.message));

  return {
    instanceId,
    async get(key) {
      return cmd.get(key);
    },
    async set(key, value, ttlMs) {
      await cmd.set(key, value, 'PX', ttlMs);
    },
    async loadRoom(code) {
      const [json, v] = (await cmd.eval(LOAD_LUA, 2, ROOM(code), VER(code))) as [string | null, string | null];
      if (!json) return null;
      return { v: Number(v ?? 0), json };
    },
    async commitRoom(code, expected, next, json, ttlMs, event) {
      if (subscribed) await subscribed;
      const ok = await cmd.eval(COMMIT_LUA, 2, ROOM(code), VER(code), expected, next, json ?? '', ttlMs, CHANNEL, event);
      return Number(ok) === 1;
    },
    async publish(event) {
      if (subscribed) await subscribed;
      await cmd.publish(CHANNEL, event);
    },
    subscribe(fn) {
      handler = fn;
      subscribed = sub.subscribe(CHANNEL);
    },
    async close() {
      handler = null;
      await Promise.allSettled([sub.quit(), cmd.quit()]);
    },
  };
}
