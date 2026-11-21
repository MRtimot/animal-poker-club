// Google 登录（OpenID Connect）：在服务器端验证 Google 签发的 ID Token。
// 我们从不接触玩家的 Google 密码；只验证 Google 的签名并读取 sub（身份）、名称和公开头像。
import crypto from 'node:crypto';

export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export interface VerifiedIdentity {
  sub: string;
  name?: string;
  picture?: string;
}

type Jwk = crypto.JsonWebKey & { kid?: string; alg?: string };

export interface GoogleVerifierOptions {
  clientId: string;
  /** 测试时注入公钥；正式环境从 Google 下载并缓存 */
  fetchJwks?: () => Promise<{ keys: Jwk[]; maxAgeMs?: number }>;
  now?: () => number;
}

export class TokenError extends Error {}

function b64urlJson(part: string): any {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('令牌格式错误');
  }
}

async function defaultFetchJwks() {
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('无法获取 Google 公钥');
  const body = (await res.json()) as { keys: Jwk[] };
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '');
  return { keys: body.keys, maxAgeMs: m ? Number(m[1]) * 1000 : 3600_000 };
}

export class GoogleVerifier {
  private keys = new Map<string, crypto.KeyObject>();
  private expires = 0;
  private loading: Promise<void> | null = null;
  private fetchJwks: NonNullable<GoogleVerifierOptions['fetchJwks']>;
  private now: () => number;

  constructor(private opts: GoogleVerifierOptions) {
    this.fetchJwks = opts.fetchJwks ?? defaultFetchJwks;
    this.now = opts.now ?? Date.now;
  }

  get clientId() {
    return this.opts.clientId;
  }

  private async loadKeys(force = false) {
    if (!force && this.keys.size && this.now() < this.expires) return;
    if (!this.loading) {
      this.loading = (async () => {
        const { keys, maxAgeMs } = await this.fetchJwks();
        const map = new Map<string, crypto.KeyObject>();
        for (const k of keys) {
          if (!k.kid || k.kty !== 'RSA') continue;
          map.set(k.kid, crypto.createPublicKey({ key: k as crypto.JsonWebKey, format: 'jwk' }));
        }
        this.keys = map;
        this.expires = this.now() + Math.min(maxAgeMs ?? 3600_000, 24 * 3600_000);
      })().finally(() => (this.loading = null));
    }
    await this.loading;
  }

  /** 验证签名、签发者、受众、过期时间、nonce 与身份字段；任何一项不通过都会抛出 TokenError */
  async verify(idToken: unknown, expectedNonce?: string): Promise<VerifiedIdentity> {
    if (typeof idToken !== 'string' || idToken.length > 4096) throw new TokenError('令牌格式错误');
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new TokenError('令牌格式错误');
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new TokenError('不支持的签名算法');

    await this.loadKeys();
    let key = this.keys.get(header.kid);
    if (!key) {
      // Google 会定期轮换公钥：找不到时强制刷新一次
      await this.loadKeys(true);
      key = this.keys.get(header.kid);
    }
    if (!key) throw new TokenError('未知的签名公钥');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new TokenError('签名无效');

    const nowSec = Math.floor(this.now() / 1000);
    const skew = 60;
    if (!GOOGLE_ISSUERS.includes(payload.iss)) throw new TokenError('签发者无效');
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(this.opts.clientId)) throw new TokenError('受众无效');
    if (Array.isArray(payload.aud) && payload.azp && payload.azp !== this.opts.clientId) throw new TokenError('受众无效');
    if (typeof payload.exp !== 'number' || payload.exp + skew < nowSec) throw new TokenError('令牌已过期');
    if (typeof payload.iat === 'number' && payload.iat - skew > nowSec) throw new TokenError('令牌时间无效');
    if (typeof payload.nbf === 'number' && payload.nbf - skew > nowSec) throw new TokenError('令牌尚未生效');
    // 防重放：令牌中的 nonce 必须与本次登录前服务器发出的一次性 nonce 相同
    if (expectedNonce !== undefined && payload.nonce !== expectedNonce) throw new TokenError('登录请求已失效');
    if (typeof payload.sub !== 'string' || !/^[0-9A-Za-z_-]{1,255}$/.test(payload.sub)) throw new TokenError('身份无效');

    return {
      sub: payload.sub,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    };
  }
}
