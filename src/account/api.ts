// 账号接口客户端：所有请求都带上 HttpOnly 会话 Cookie（前端读不到令牌本身）
import type { AccountState } from '../core/account/types';
import { serverHttpBase } from '../net/serverAddress';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: any = null,
  ) {
    super(message);
  }
  /** 网络断开 / 服务器无响应 */
  get offline() {
    return this.status === 0;
  }
}

/** 账号接口与游戏服务器在同一个地址（自定义服务器 / Vercel + Render 分开部署时也一样） */
const base = serverHttpBase;

export async function api<T = any>(method: string, path: string, body?: unknown, timeoutMs = 10000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(base() + path, {
      method,
      // 只向同一个网站发送登录 Cookie（网页与服务器分开部署时，只使用游客模式）
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, '网络连接失败');
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? '服务器暂时无法同步你的资料，请稍后再试。', data);
  return data as T;
}

export const accountApi = {
  config: () => api<{ googleClientId: string | null; devLogin: boolean }>('GET', '/api/auth/config', undefined, 5000),
  nonce: () => api<{ nonce: string }>('GET', '/api/auth/nonce'),
  google: (credential: string) => api<{ state: AccountState }>('POST', '/api/auth/google', { credential }),
  dev: (name: string) => api<{ state: AccountState }>('POST', '/api/auth/dev', { name }),
  logout: () => api('POST', '/api/auth/logout', {}),
  me: () => api<{ state: AccountState }>('GET', '/api/player/me'),
  patchProfile: (patch: Record<string, unknown>, baseVersion?: number) => api<{ state: AccountState }>('PATCH', '/api/player/profile', { ...patch, baseVersion }),
  patchSettings: (settings: Record<string, unknown>) => api<{ state: AccountState }>('PATCH', '/api/player/settings', { settings }),
  migrateGuest: (guest: unknown) => api<{ state: AccountState; migrated: boolean }>('POST', '/api/player/migrate-guest', { guest }),
  deleteAccount: () => api('DELETE', '/api/player/account', { confirm: '删除账号' }),
};
