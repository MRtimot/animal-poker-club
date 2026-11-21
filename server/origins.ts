// 允许连接游戏服务器的网页来源。
// 网页和服务器分开部署时（例如网页在 Vercel、服务器在 Render），在 APC_ALLOWED_ORIGINS 里填写网页地址，
// 多个用逗号分隔；支持通配子域名，例如 https://*.vercel.app（Vercel 预览部署）。
import type http from 'node:http';

export function allowedOrigins(): string[] {
  return (process.env.APC_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/** 来源是否在允许列表中（不含“同一个网站”的情况） */
export function inAllowList(origin: string, list = allowedOrigins()): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  return list.some((entry) => {
    const m = /^(https?):\/\/\*\.(.+)$/.exec(entry);
    if (m) return o.protocol === m[1] + ':' && o.hostname.endsWith('.' + m[2]);
    return entry === `${o.protocol}//${o.host}`;
  });
}

export function isSameSite(req: http.IncomingMessage, origin: string): boolean {
  try {
    return new URL(origin).host === (req.headers['x-forwarded-host'] ?? req.headers.host);
  } catch {
    return false;
  }
}

/**
 * 浏览器连接是否允许：同一个网站、或在允许列表中。
 * 没有设置允许列表时不限制来源（兼容局域网 / 自定义服务器地址的玩法）。
 */
export function originAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // 非浏览器客户端
  if (isSameSite(req, origin)) return true;
  const list = allowedOrigins();
  return list.length === 0 || inAllowList(origin, list);
}
