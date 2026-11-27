// 客户端 IP：用于“每个 IP 的连接数 / 请求频率”限制（防刷连接、防刷登录）。
//
// X-Forwarded-For 是请求里的普通标头，客户端可以随便填写。以前直接取它的第一项：
// 直接暴露在公网的服务器上，任何人每次换一个假地址就能绕过所有按 IP 的限制；
// 即使前面有 Nginx / Caddy，它们是在原有内容后面“追加”真实地址，第一项仍然是客户端自己写的。
//
// 现在：只有在可信的代理后面才读取这个标头，并且从后往前数——最后一项是离我们最近的可信代理亲眼看到的地址。
// · 请求来自本机 / 内网（同一台机器或内网里的 Nginx、Caddy）：信任 1 层代理
// · 在 Vercel 上（Vercel 会改写这个标头，只留下真实的客户端地址）：信任 1 层
// · 其他情况（直接暴露在公网）：不读取标头，只用连接本身的地址
// · 部署在多层代理后面（例如 Cloudflare → Nginx → 本服务器）：设置 APC_TRUST_PROXY=代理层数（例如 2）；0 = 永远不读取
import type http from 'node:http';

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];

/** 本机或内网地址（IPv4、IPv6、IPv4 映射的 IPv6） */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase();
  if (!a) return false;
  if (a === '::1') return true;
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  if (PRIVATE_V4.some((r) => r.test(v4))) return true;
  // IPv6 唯一本地地址 fc00::/7 与链路本地地址 fe80::/10
  return /^f[cd][0-9a-f]{0,2}:/.test(a) || /^fe[89ab][0-9a-f]?:/.test(a);
}

/** 信任几层代理（环境变量优先） */
function trustedHops(remote: string, env: NodeJS.ProcessEnv): number {
  const raw = env.APC_TRUST_PROXY?.trim();
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 0;
  }
  return env.VERCEL || isPrivateAddress(remote) ? 1 : 0;
}

/** 这个请求来自哪个客户端 IP（用于限流；不是身份验证） */
export function clientIp(req: Pick<http.IncomingMessage, 'headers' | 'socket'>, env: NodeJS.ProcessEnv = process.env): string {
  const remote = String(req.socket?.remoteAddress ?? '');
  const hops = trustedHops(remote, env);
  if (hops > 0) {
    const raw = req.headers['x-forwarded-for'];
    const list = (Array.isArray(raw) ? raw.join(',') : String(raw ?? ''))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // 最后 hops 项是可信代理追加的；再往前的都可能是客户端伪造的
    if (list.length) return list[Math.max(0, list.length - hops)].slice(0, 64);
  }
  return remote;
}
