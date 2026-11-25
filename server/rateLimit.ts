// 轻量限流（固定时间窗口计数），只用内存，不依赖任何外部服务
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  /** 记录一次请求；超过上限返回 false */
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now >= h.reset) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    h.n++;
    return h.n <= this.limit;
  }

  sweep(now = Date.now()) {
    for (const [k, v] of this.hits) if (now >= v.reset) this.hits.delete(k);
  }
}

/** 实时连接的消息分类与限额：建房 / 加入、聊天、牌局动作、重连 */
export const WS_LIMITS = {
  room: { limit: 12, windowMs: 10_000 },
  chat: { limit: 6, windowMs: 10_000 },
  action: { limit: 15, windowMs: 5_000 },
  hello: { limit: 6, windowMs: 10_000 },
  other: { limit: 40, windowMs: 10_000 },
  /** 所有消息总量：明显超过正常玩家的速度就断开连接 */
  flood: { limit: 120, windowMs: 10_000 },
} as const;

export type WsCategory = Exclude<keyof typeof WS_LIMITS, 'flood'>;

export function categoryOf(t: string): WsCategory {
  switch (t) {
    case 'createRoom':
    case 'joinRoom':
    case 'startSolo':
    case 'restartSolo':
    case 'addAI':
    case 'removeMember':
    case 'startGame':
    case 'backToLobby':
    case 'ready':
      return 'room';
    // leaveRoom 不算在建房限额里：离开被限流拒绝时，玩家会回到首页却仍占着座位
    case 'chat':
    case 'emote':
      return 'chat';
    case 'action':
      return 'action';
    case 'hello':
      return 'hello';
    default:
      return 'other';
  }
}

/** 每条连接一组限流器 */
export function connectionLimiter() {
  const lim = Object.fromEntries(Object.entries(WS_LIMITS).map(([k, v]) => [k, new RateLimiter(v.limit, v.windowMs)])) as Record<
    keyof typeof WS_LIMITS,
    RateLimiter
  >;
  let warnedAt = 0;
  return {
    /** 'ok' | 'limited'（拒绝这条消息）| 'flood'（断开连接） */
    check(t: string): 'ok' | 'limited' | 'flood' {
      if (!lim.flood.allow('x')) return 'flood';
      return lim[categoryOf(t)].allow('x') ? 'ok' : 'limited';
    },
    /** 同一窗口内只提示一次，避免把提示本身变成刷屏 */
    shouldWarn(now = Date.now()) {
      if (now - warnedAt < 3000) return false;
      warnedAt = now;
      return true;
    },
  };
}
