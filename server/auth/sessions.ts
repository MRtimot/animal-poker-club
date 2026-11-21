// 登录会话：随机令牌放在 HttpOnly Cookie 中（前端 JavaScript 读不到），数据库只保存其摘要
import crypto from 'node:crypto';
import type http from 'node:http';
import type { DB } from '../db/database';

export const SESSION_COOKIE = 'apc_sid';
export const NONCE_COOKIE = 'apc_nonce';
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export interface CookieOpts {
  maxAgeMs: number;
  secure: boolean;
  path?: string;
}

export function cookie(name: string, value: string, o: CookieOpts) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(o.maxAgeMs / 1000)}`];
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

/** 是否通过 HTTPS 访问（直接 HTTPS 或经过反向代理） */
export function isSecureRequest(req: http.IncomingMessage, production: boolean) {
  if ((req.socket as any).encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  if (proto === 'https') return true;
  return production && process.env.APC_INSECURE_COOKIES !== '1';
}

export class SessionStore {
  constructor(private db: DB) {}

  create(userId: string): string {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(hash(token), userId, now, now + SESSION_TTL_MS, now);
    return token;
  }

  /** 返回会话对应的玩家 ID；过期或不存在返回 null。活跃会话会自动续期 */
  resolve(token: string | undefined): string | null {
    if (!token || token.length > 200) return null;
    const h = hash(token);
    const row = this.db.prepare('SELECT user_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?').get(h) as any;
    if (!row) return null;
    const now = Date.now();
    if (Number(row.expires_at) < now) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
      return null;
    }
    if (now - Number(row.last_seen_at) > 3600_000) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(now, now + SESSION_TTL_MS, h);
    }
    return row.user_id as string;
  }

  revoke(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
  }

  revokeAll(userId: string) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  sweep() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  }
}
