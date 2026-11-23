// Cookie / 会话 / 身份 深度审计：Cookie 属性、会话生命周期、WebSocket 身份、玩家与房间身份、复制标签页
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import { openDatabase } from '../server/db/database';
import { SessionStore, parseCookies } from '../server/auth/sessions';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/core/protocol';
import { startTabSession } from '../src/net/tabSession';
import { parseAccountCache } from '../src/account/cacheValidate';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as any), kid: 'k1', alg: 'RS256', use: 'sig' };
const fetchJwks = async () => ({ keys: [jwk] });

function idToken(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 3600, sub: 'sess-user-1', name: 'Session Tester', ...claims })}`;
  return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}

async function until(cond: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** 模拟浏览器的 Cookie 罐 */
class Browser {
  cookies = new Map<string, string>();
  setCookies: string[] = [];
  constructor(public port: number) {}
  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(`http://localhost:${this.port}${p}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie: this.cookieHeader },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.setCookies = res.headers.getSetCookie();
    for (const c of this.setCookies) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (/Max-Age=0/.test(c)) this.cookies.delete(kv.slice(0, i));
      else this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
  }
  async login(sub = 'sess-user-1') {
    const n = await this.req('GET', '/api/auth/nonce');
    const nonceCookie = this.setCookies.join('\n');
    const r = await this.req('POST', '/api/auth/google', { credential: idToken({ nonce: n.body.nonce, sub }) });
    return { r, nonceCookie, loginCookies: this.setCookies.join('\n') };
  }
}

/** 打开一条实时连接（可指定 Cookie、Origin、会话编号） */
async function socket(port: number, o: { cookie?: string; origin?: string; sessionId?: string } = {}) {
  const ws = new WebSocket(`ws://localhost:${port}/api/ws`, { headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.origin ? { origin: o.origin } : {}) } });
  const msgs: ServerMessage[] = [];
  let closeCode = 0;
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  ws.on('close', (c) => (closeCode = c));
  await new Promise<void>((r, j) => {
    ws.on('open', () => r());
    ws.on('error', j);
  });
  ws.send(JSON.stringify({ t: 'hello', sessionId: o.sessionId, profile: { name: '测试', animal: DEFAULT_ANIMAL } }));
  await until(() => msgs.some((m) => m.t === 'welcome') || closeCode !== 0);
  const welcome = msgs.find((m) => m.t === 'welcome') as Extract<ServerMessage, { t: 'welcome' }> | undefined;
  return { ws, msgs, welcome, closed: () => closeCode, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-sess-'));
const dbPath = path.join(dir, 'apc.sqlite');
let srv: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  srv = await createServer(0, { dbPath, google: { clientId: CLIENT_ID, fetchJwks }, pace: 0.02, turnTimeMs: 400 });
});
afterAll(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Cookie 清单与安全属性', () => {
  it('只有两个 Cookie：apc_nonce（登录随机数）与 apc_sid（登录会话）；都 HttpOnly + SameSite=Lax，作用路径与有效期正确，令牌不出现在响应内容里', async () => {
    const b = new Browser(srv.port);
    const { r, nonceCookie, loginCookies } = await b.login();
    expect(r.status).toBe(200);
    expect(nonceCookie).toMatch(/^apc_nonce=[^;]+; Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=600$/);
    const sid = loginCookies.split('\n').find((c) => c.startsWith('apc_sid='))!;
    expect(sid).toMatch(/^apc_sid=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    // 登录成功后随机数 Cookie 被清除（同一路径，Max-Age=0）
    expect(loginCookies).toMatch(/apc_nonce=; Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=0/);
    expect([...b.cookies.keys()]).toEqual(['apc_sid']);
    // 令牌只在 HttpOnly Cookie 里：响应内容（前端能读到的部分）不包含它
    expect(r.raw).not.toContain(b.cookies.get('apc_sid')!);
    // 游客模式（没有账号系统）的服务器根本不设置 Cookie
    const guestSrv = await createServer(0, {});
    try {
      const g = new Browser(guestSrv.port);
      await g.req('GET', '/api/auth/config');
      expect(g.setCookies).toEqual([]);
    } finally {
      await guestSrv.close();
    }
  });
});

describe('登录会话生命周期', () => {
  it('退出登录：服务器端会话立即作废，用旧 Cookie 重放会被拒绝', async () => {
    const b = new Browser(srv.port);
    await b.login();
    const stolen = b.cookieHeader;
    expect((await b.req('GET', '/api/player/me')).status).toBe(200);
    const out = await b.req('POST', '/api/auth/logout', {});
    expect(out.status).toBe(200);
    expect(b.setCookies.join()).toMatch(/apc_sid=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);
    const replay = await fetch(`http://localhost:${srv.port}/api/player/me`, { headers: { cookie: stolen } });
    expect(replay.status).toBe(401);
  });

  it('防会话固定：带着旧会话再次登录时，旧令牌作废，换发新令牌', async () => {
    const b = new Browser(srv.port);
    await b.login();
    const old = b.cookieHeader;
    await b.login();
    expect(b.cookieHeader).not.toBe(old);
    expect((await fetch(`http://localhost:${srv.port}/api/player/me`, { headers: { cookie: old } })).status).toBe(401);
    expect((await b.req('GET', '/api/player/me')).status).toBe(200);
  });

  it('过期 / 格式错误 / 伪造的会话令牌一律拒绝；过期记录被删除；数据库只保存令牌摘要', () => {
    const f = path.join(dir, 'unit.sqlite');
    const db = openDatabase(f);
    const store = new SessionStore(db);
    db.prepare("INSERT INTO users (id, created_at, last_login_at) VALUES ('u1', 0, 0)").run();
    const token = store.create('u1');
    expect(store.resolve(token)).toBe('u1');
    // 数据库里找不到明文令牌
    const rows = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    // 过期
    db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
    expect(store.resolve(token)).toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0);
    for (const bad of [undefined, '', 'x', 'a'.repeat(500), token + 'x', '../../etc/passwd']) expect(store.resolve(bad)).toBeNull();
    // Cookie 解析：重复的同名 Cookie 只取第一个，格式错误不会抛错
    expect(parseCookies('apc_sid=a; apc_sid=b; junk; =x; y=%E0%A4%A')).toEqual({ apc_sid: 'a', y: '%E0%A4%A' });
  });
});

describe('WebSocket 身份', () => {
  it('登录身份只来自服务器验证的 Cookie：同站连接带上账号；跨站页面带着 Cookie 也只能是游客；没有 Cookie 是游客', async () => {
    const b = new Browser(srv.port);
    await b.login('ws-user');
    const same = await socket(srv.port, { cookie: b.cookieHeader, origin: `http://localhost:${srv.port}` });
    await until(() => same.msgs.some((m) => m.t === 'account'));
    expect((same.msgs.find((m) => m.t === 'account') as any).state.nickname).toBeTruthy();
    const evil = await socket(srv.port, { cookie: b.cookieHeader, origin: 'https://evil.example' });
    expect(evil.welcome).toBeTruthy();
    await new Promise((r) => setTimeout(r, 200));
    expect(evil.msgs.some((m) => m.t === 'account')).toBe(false);
    const anon = await socket(srv.port);
    await new Promise((r) => setTimeout(r, 200));
    expect(anon.msgs.some((m) => m.t === 'account')).toBe(false);
    for (const c of [same, evil, anon]) c.ws.close();
  });

  it('玩家编号由服务器生成：同一会话重连得到同一玩家与房间；不同浏览器得到不同玩家；伪造 / 格式错误的会话编号得到新玩家', async () => {
    const a = await socket(srv.port);
    const b = await socket(srv.port);
    expect(a.welcome!.playerId).toMatch(/^u_[a-z0-9]{10}$/);
    expect(a.welcome!.protocol).toBe(PROTOCOL_VERSION);
    expect(a.welcome!.playerId).not.toBe(b.welcome!.playerId);
    expect(a.welcome!.sessionId).not.toBe(b.welcome!.sessionId);
    expect(a.welcome!.sessionId).not.toBe(a.welcome!.playerId);
    a.send({ t: 'createRoom', settings: { maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => a.msgs.some((m) => m.t === 'room' && (m as any).room));
    const code = (a.msgs.find((m) => m.t === 'room' && (m as any).room) as any).room.code as string;
    // 房间代码 ≠ 会话 ≠ 玩家
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    a.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const again = await socket(srv.port, { sessionId: a.welcome!.sessionId });
    expect(again.welcome!.resumed).toBe(true);
    expect(again.welcome!.playerId).toBe(a.welcome!.playerId);
    await until(() => again.msgs.some((m) => m.t === 'room' && (m as any).room?.code === code));
    const room = (again.msgs.find((m) => m.t === 'room' && (m as any).room) as any).room;
    expect(room.members.filter((m: any) => m.id === a.welcome!.playerId)).toHaveLength(1);
    for (const bad of ['short', 'bad!!session!!id', 'x'.repeat(200)]) {
      const c = await socket(srv.port, { sessionId: bad });
      expect(c.welcome!.resumed).toBe(false);
      expect(c.welcome!.playerId).not.toBe(a.welcome!.playerId);
      c.ws.close();
    }
    again.send({ t: 'leaveRoom' });
    await until(() => !srv.rooms.getRoom(code));
    again.ws.close();
    b.ws.close();
  });

  it('同一会话在另一个页面连接：旧连接收到“已被替换”通知并被关闭（客户端据此停止自动重连），座位只属于新连接', async () => {
    const a = await socket(srv.port);
    const dup = await socket(srv.port, { sessionId: a.welcome!.sessionId });
    expect(dup.welcome!.playerId).toBe(a.welcome!.playerId);
    await until(() => a.msgs.some((m) => m.t === 'notice'));
    expect(a.msgs.find((m) => m.t === 'notice')).toMatchObject({ t: 'notice', kind: 'replaced' });
    await until(() => a.closed() !== 0);
    dup.ws.close();
  });
});

describe('复制标签页（sessionStorage 被一起复制）', () => {
  it('另一个标签页正在使用同一会话：复制出来的标签页换成新会话；没有其他标签页（刷新页面）时保留会话', async () => {
    // 原标签页：会话 S1
    let sidA: string | undefined = 'S1';
    const tabA = startTabSession({ getSessionId: () => sidA, resetSession: () => (sidA = undefined) });
    expect(await tabA.ready).toBe(false);
    // 复制出来的标签页：也是 S1 → 被告知已占用 → 清除
    let sidB: string | undefined = 'S1';
    const tabB = startTabSession({ getSessionId: () => sidB, resetSession: () => (sidB = undefined) });
    expect(await tabB.ready).toBe(true);
    expect(sidB).toBeUndefined();
    expect(sidA).toBe('S1');
    // 另一个会话 S2 的标签页不受影响
    let sidC: string | undefined = 'S2';
    const tabC = startTabSession({ getSessionId: () => sidC, resetSession: () => (sidC = undefined) });
    expect(await tabC.ready).toBe(false);
    expect(sidC).toBe('S2');
    // 刷新页面：旧页面已经关闭（频道关闭）→ 新页面保留 S1，可以回到座位
    tabA.close();
    let sidD: string | undefined = 'S1';
    const tabD = startTabSession({ getSessionId: () => sidD, resetSession: () => (sidD = undefined) });
    expect(await tabD.ready).toBe(false);
    expect(sidD).toBe('S1');
    for (const t of [tabB, tabC, tabD]) t.close();
  });
});

describe('本机账号缓存（apc-account-cache）损坏', () => {
  const good = {
    nickname: '小明',
    avatarUrl: null,
    onboarded: true,
    createdAt: 1,
    animal: { ...DEFAULT_ANIMAL },
    characters: [],
    level: 3,
    xp: 300,
    chips: 1000,
    stats: {},
    achievements: {},
    unlockedAnimals: ['cat'],
    settings: {},
    recent: [],
    version: 4,
    dataVersion: 1,
  };
  it('结构正确的缓存可以使用；损坏 / 被修改的缓存被丢弃（不会让登录流程崩溃）', () => {
    expect(parseAccountCache(JSON.stringify(good))?.nickname).toBe('小明');
    const bad = [
      null,
      '',
      '{oops',
      'null',
      '[]',
      '"text"',
      JSON.stringify({ ...good, characters: 'banana' }),
      JSON.stringify({ ...good, achievements: null }),
      JSON.stringify({ ...good, recent: {} }),
      JSON.stringify({ ...good, xp: 'banana' }),
      JSON.stringify({ ...good, level: -5 }),
      JSON.stringify({ ...good, nickname: 42 }),
      JSON.stringify({ ...good, settings: [] }),
      JSON.stringify({ ...good, version: undefined }),
    ];
    for (const b of bad) expect(parseAccountCache(b), String(b)).toBeNull();
  });
});
