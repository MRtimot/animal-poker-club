// Vercel 函数：告诉网页“只有游客模式”（全部部署在 Vercel 时不使用账号系统和数据库）
export default function handler(_req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.statusCode = 200;
  res.end(JSON.stringify({ googleClientId: null, devLogin: false, accounts: false }));
}
