// 账号 HTTP 接口（/api/*）。只负责：解析请求 → 身份校验 → 调用账号服务 → 返回结果
// 所有进度类数据（经验、等级、筹码、成就）都没有“写入”接口，只能由服务器结算产生
import crypto from 'node:crypto';
import type http from 'node:http';
import { AccountError, type AccountService } from './account/accounts';
import { GoogleVerifier, TokenError } from './auth/google';
import { NONCE_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, cookie, isSecureRequest, parseCookies, type SessionStore } from './auth/sessions';
import type { AccountState } from '../src/core/account/types';
import { inAllowList, isSameSite } from './origins';
import { clientIp } from './clientIp';

export interface ApiOptions {
  accounts: AccountService;
  sessions: SessionStore;
  google: GoogleVerifier | null;
  /** 开发环境的测试登录（正式环境永远关闭） */
  devLogin: boolean;
  production: boolean;
  /** 账号数据变化时通知该玩家的所有在线设备 */
  onAccountChanged?: (userId: string, state: AccountState) => void;
  onAccountDeleted?: (userId: string) => void;
}

const MAX_BODY = 64 * 1024;
const GENERIC_SYNC_ERROR = '服务器暂时无法同步你的资料，请稍后再试。';
const LOGIN_FAILED = '登录失败，请重新尝试。';

function send(res: http.ServerResponse, status: number, body: unknown, cookies: string[] = []) {
  const headers: Record<string, string | string[]> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new AccountError(413, '请求内容过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new AccountError(400, '请求格式错误'));
      }
    });
    req.on('error', reject);
  });
}

/** 简单的按 IP 限流，防止暴力尝试登录接口 */
class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}
  allow(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || now > h.reset) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      if (this.hits.size > 5000) for (const [k, v] of this.hits) if (now > v.reset) this.hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= this.limit;
  }
}

export function createApi(o: ApiOptions) {
  const authLimiter = new RateLimiter(30, 60_000);
  const writeLimiter = new RateLimiter(240, 60_000);

  const sessionCookie = (req: http.IncomingMessage, token: string) =>
    cookie(SESSION_COOKIE, token, { maxAgeMs: SESSION_TTL_MS, secure: isSecureRequest(req, o.production) });
  const clearCookie = (req: http.IncomingMessage, name: string, path = '/') => cookie(name, '', { maxAgeMs: 0, secure: isSecureRequest(req, o.production), path });

  /** 写操作必须来自本站页面（防止跨站请求伪造） */
  function sameOrigin(req: http.IncomingMessage) {
    const origin = req.headers.origin;
    if (!origin) return true; // 非浏览器客户端（测试、命令行）
    return isSameSite(req, origin) || inAllowList(origin);
  }

  function currentUser(req: http.IncomingMessage) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return { token, userId: o.sessions.resolve(token) };
  }

  function logDev(label: string, err: unknown) {
    if (!o.production) console.warn(`[账号] ${label}`, err);
  }

  async function login(req: http.IncomingMessage, res: http.ServerResponse, identity: Parameters<AccountService['loginWithIdentity']>[0]) {
    const { userId, isNew } = o.accounts.loginWithIdentity(identity);
    // 旧会话作废，防止会话固定攻击
    o.sessions.revoke(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    const token = o.sessions.create(userId);
    const state = { ...o.accounts.getState(userId), isNew };
    send(res, 200, { state }, [sessionCookie(req, token), clearCookie(req, NONCE_COOKIE, '/api/auth')]);
  }

  /** 处理 /api/* 请求；返回 false 表示不是 API 路径 */
  return async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    const method = req.method ?? 'GET';
    const route = `${method} ${url.pathname}`;
    // 不能直接相信 X-Forwarded-For（客户端可以伪造来绕过限流），见 clientIp.ts
    const ip = clientIp(req);

    try {
      if (method !== 'GET' && method !== 'HEAD') {
        if (!sameOrigin(req)) return send(res, 403, { error: '请求来源无效' }), true;
        const ct = String(req.headers['content-type'] ?? '');
        if (method !== 'DELETE' && !ct.includes('application/json')) return send(res, 415, { error: '请求格式错误' }), true;
        if (!writeLimiter.allow(ip)) return send(res, 429, { error: '操作太频繁，请稍后再试' }), true;
      }

      switch (route) {
        case 'GET /api/auth/config':
          send(res, 200, { googleClientId: o.google?.clientId ?? null, devLogin: o.devLogin, accounts: true });
          return true;

        case 'GET /api/auth/nonce': {
          const nonce = crypto.randomBytes(18).toString('base64url');
          send(res, 200, { nonce }, [cookie(NONCE_COOKIE, nonce, { maxAgeMs: 10 * 60_000, secure: isSecureRequest(req, o.production), path: '/api/auth' })]);
          return true;
        }

        case 'POST /api/auth/google': {
          if (!authLimiter.allow(ip)) return send(res, 429, { error: '尝试次数过多，请稍后再试' }), true;
          if (!o.google) return send(res, 503, { error: 'Google 登录尚未配置' }), true;
          const body = await readBody(req);
          const nonce = parseCookies(req.headers.cookie)[NONCE_COOKIE];
          let identity;
          try {
            if (!nonce) throw new TokenError('缺少 nonce');
            identity = await o.google.verify(body?.credential, nonce);
          } catch (err) {
            logDev('Google 令牌验证失败', err);
            send(res, 401, { error: LOGIN_FAILED });
            return true;
          }
          await login(req, res, { provider: 'google', subject: identity.sub, name: identity.name, picture: identity.picture });
          return true;
        }

        case 'POST /api/auth/dev': {
          if (!o.devLogin) return send(res, 404, { error: '接口不存在' }), true;
          const body = await readBody(req);
          const name = String(body?.name ?? '').trim().slice(0, 24);
          if (!name) return send(res, 400, { error: '请输入测试账号名' }), true;
          const subject = crypto.createHash('sha256').update(name).digest('hex').slice(0, 32);
          await login(req, res, { provider: 'dev', subject, name });
          return true;
        }

        case 'POST /api/auth/logout': {
          const { token } = currentUser(req);
          o.sessions.revoke(token);
          send(res, 200, { ok: true }, [clearCookie(req, SESSION_COOKIE)]);
          return true;
        }
      }

      // 以下接口都需要登录
      if (url.pathname.startsWith('/api/player/')) {
        const { userId } = currentUser(req);
        if (!userId) return send(res, 401, { error: '请先登录' }), true;

        switch (route) {
          case 'GET /api/player/me':
          case 'GET /api/player/profile':
            send(res, 200, { state: o.accounts.getState(userId) });
            return true;
          case 'GET /api/player/progress': {
            const s = o.accounts.getState(userId);
            send(res, 200, { level: s.level, xp: s.xp, chips: s.chips, stats: s.stats, recent: s.recent });
            return true;
          }
          case 'GET /api/player/inventory': {
            const s = o.accounts.getState(userId);
            send(res, 200, { animals: s.unlockedAnimals, characters: s.characters, selectedAnimal: s.animal });
            return true;
          }
          case 'GET /api/player/achievements':
            send(res, 200, { achievements: o.accounts.getState(userId).achievements });
            return true;

          case 'PATCH /api/player/profile': {
            const body = await readBody(req);
            const { baseVersion, ...patch } = body ?? {};
            const state = o.accounts.updateProfile(userId, patch, typeof baseVersion === 'number' ? baseVersion : undefined);
            o.onAccountChanged?.(userId, state);
            send(res, 200, { state });
            return true;
          }
          case 'PATCH /api/player/settings': {
            const body = await readBody(req);
            const state = o.accounts.updateSettings(userId, body?.settings);
            o.onAccountChanged?.(userId, state);
            send(res, 200, { state });
            return true;
          }
          case 'POST /api/player/migrate-guest': {
            const body = await readBody(req);
            const { state, migrated } = o.accounts.migrateGuest(userId, body?.guest);
            o.onAccountChanged?.(userId, state);
            send(res, 200, { state, migrated });
            return true;
          }
          case 'DELETE /api/player/account': {
            const body = await readBody(req).catch(() => ({}));
            if (body?.confirm !== '删除账号') return send(res, 400, { error: '请输入“删除账号”以确认' }), true;
            o.onAccountDeleted?.(userId);
            o.accounts.deleteAccount(userId);
            send(res, 200, { ok: true }, [clearCookie(req, SESSION_COOKIE)]);
            return true;
          }
        }
      }

      send(res, 404, { error: '接口不存在' });
      return true;
    } catch (err) {
      if (err instanceof AccountError) {
        if (err.status === 409) {
          const { userId } = currentUser(req);
          send(res, 409, { error: err.message, state: userId ? o.accounts.getState(userId) : undefined });
        } else send(res, err.status, { error: err.message });
        return true;
      }
      // 数据库或未知错误：不向玩家暴露任何技术细节
      logDev(`${route} 出错`, err);
      if (o.production) console.error(`[账号] ${route} 出错`);
      send(res, 503, { error: GENERIC_SYNC_ERROR });
      return true;
    }
  };
}
