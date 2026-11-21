// 房间状态的共享存储。
// - 单台服务器（本地开发 / Render）：MemoryStore，所有状态在进程内存中
// - Vercel（同一时间可能有多台函数实例）：RedisStore，房间状态放在 Redis，实例之间用发布 / 订阅同步
// 每次修改房间都用“版本号比较并写入”（CAS）保证多台服务器同时修改时不会互相覆盖。

export interface SharedStore {
  /** 当前服务器实例的 ID（每个进程 / 函数实例不同） */
  readonly instanceId: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** 读取房间记录（含版本号） */
  loadRoom(code: string): Promise<{ v: number; json: string } | null>;
  /**
   * 版本号等于 expected 时写入新记录并发布事件（原子操作）；否则返回 false（别的服务器先改了）。
   * json = null 表示删除房间。
   */
  commitRoom(code: string, expected: number, next: number, json: string | null, ttlMs: number, event: string): Promise<boolean>;
  /** 只发布事件、不修改房间（例如“玩家已在另一台服务器重新连接”） */
  publish(event: string): Promise<void>;
  /** 订阅所有房间事件（包括自己发布的） */
  subscribe(handler: (event: string) => void): void;
  close(): Promise<void>;
}

/** 进程内共享中心：同一进程里可以创建多个“实例”，用于测试多台服务器的情况 */
export class MemoryHub {
  private data = new Map<string, { value: string; exp: number }>();
  private subs = new Set<(e: string) => void>();
  rooms = new Map<string, { v: number; json: string; exp: number }>();

  store(instanceId: string): SharedStore {
    const hub = this;
    let handler: ((e: string) => void) | null = null;
    let closed = false;
    const deliver = (e: string) => {
      // 异步投递，与 Redis 的发布 / 订阅行为一致
      for (const fn of [...hub.subs]) queueMicrotask(() => fn(e));
    };
    return {
      instanceId,
      async get(key) {
        const d = hub.data.get(key);
        if (!d || d.exp < Date.now()) return null;
        return d.value;
      },
      async set(key, value, ttlMs) {
        hub.data.set(key, { value, exp: Date.now() + ttlMs });
      },
      async loadRoom(code) {
        const r = hub.rooms.get(code);
        if (!r || r.exp < Date.now()) return null;
        return { v: r.v, json: r.json };
      },
      async commitRoom(code, expected, next, json, ttlMs, event) {
        const cur = hub.rooms.get(code);
        const curV = cur && cur.exp >= Date.now() ? cur.v : 0;
        if (curV !== expected) return false;
        if (json === null) hub.rooms.delete(code);
        else hub.rooms.set(code, { v: next, json, exp: Date.now() + ttlMs });
        deliver(event);
        return true;
      },
      async publish(event) {
        deliver(event);
      },
      subscribe(fn) {
        handler = (e) => {
          if (!closed) fn(e);
        };
        hub.subs.add(handler);
      },
      async close() {
        closed = true;
        if (handler) hub.subs.delete(handler);
      },
    };
  }
}
