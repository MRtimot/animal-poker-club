// 账号系统测试：Google 登录 → 玩家档案 → 云端存档 → 自动同步 → 防作弊
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import type { ServerMessage } from '../src/core/protocol';
import type { AccountState } from '../src/core/account/types';
import { GUEST_LIMITS } from '../server/account/accounts';
import { levelFromXp } from '../src/progress/progression';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: evilKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as any), kid: 'k1', alg: 'RS256', use: 'sig' };
const fetchJwks = async () => ({ keys: [jwk] });

function idToken(claims: Record<string, unknown>, key = privateKey, kid = 'k1') {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = { iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 3600, sub: '1234567890', name: 'Tan Ah Kow', picture: 'https://lh3.googleusercontent.com/a/abc', email: 'tan@example.com', ...claims };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(data), key).toString('base64url');
  return `${data}.${sig}`;
}

/** 模拟一个浏览器：保存 Cookie */
class Browser {
  cookies = new Map<string, string>();
  constructor(public port: number) {}
  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`http://localhost:${this.port}${p}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie: this.cookieHeader, ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i);
      const v = kv.slice(i + 1);
      if (/Max-Age=0/.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, raw: text, headers: res.headers };
  }
  async googleLogin(claims: Record<string, unknown> = {}, key = privateKey) {
    const n = await this.req('GET', '/api/auth/nonce');
    return this.req('POST', '/api/auth/google', { credential: idToken({ nonce: n.body.nonce, ...claims }, key) });
  }
  async ws() {
    const ws = new WebSocket(`ws://localhost:${this.port}/ws`, { headers: { cookie: this.cookieHeader } });
    const msgs: ServerMessage[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws.on('open', () => r()));
    ws.send(JSON.stringify({ t: 'hello', profile: { name: '冒充者', animal: DEFAULT_ANIMAL, level: 99 } }));
    await until(() => msgs.some((m) => m.t === 'welcome'));
    return { ws, msgs, send: (m: unknown) => ws.send(JSON.stringify(m)) };
  }
}

async function until(cond: () => boolean, ms = 8000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-acc-'));
const dbPath = path.join(dir, 'apc.sqlite');
let srv: Awaited<ReturnType<typeof createServer>>;
const boot = () => createServer(0, { dbPath, google: { clientId: CLIENT_ID, fetchJwks }, pace: 0.02, turnTimeMs: 400 });

beforeAll(async () => {
  srv = await boot();
});
afterAll(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 登录后打一场单人对局（总是全押，几手就能结束） */
async function playSoloGame(b: Browser) {
  const c = await b.ws();
  c.send({ t: 'startSolo', settings: { opponents: [{ personality: 'smartCat', difficulty: 'easy' }], startingChips: 1000, smallBlind: 10, bigBlind: 20 } });
  let lastActed = '';
  const iv = setInterval(() => {
    const st = [...c.msgs].reverse().find((m) => m.t === 'state') as any;
    const v = st?.view;
    if (!v || v.gameOver) return;
    const key = `${v.handNumber}:${v.events.length}`;
    if (v.currentPlayerId === v.viewerId && v.legal && key !== lastActed) {
      lastActed = key;
      c.send({ t: 'action', action: { type: v.legal.canAllIn ? 'allin' : v.legal.canCheck ? 'check' : 'call' } });
    }
  }, 15);
  await until(() => c.msgs.some((m) => m.t === 'state' && (m as any).view.gameOver), 30000);
  await until(() => c.msgs.filter((m) => m.t === 'progress').length >= 2, 5000);
  clearInterval(iv);
  return c;
}

describe('Google 登录与玩家档案', () => {
  const sub = '1234567890';
  let first: AccountState;

  it('测试 1：第一次 Google 登录 → 创建玩家（不暴露 Google ID / 邮箱 / Token）', async () => {
    const b = new Browser(srv.port);
    const cfg = await b.req('GET', '/api/auth/config');
    expect(cfg.body.googleClientId).toBe(CLIENT_ID);
    expect(cfg.body.devLogin).toBe(false);
    const r = await b.googleLogin();
    expect(r.status).toBe(200);
    first = r.body.state;
    expect(first.isNew).toBe(true);
    expect(first.level).toBe(1);
    expect(first.xp).toBe(0);
    expect(first.chips).toBe(1000);
    expect(first.unlockedAnimals).toContain('cat');
    expect(first.unlockedAnimals).not.toContain('fox');
    expect(first.nickname).toBe('Tan Ah Kow');
    expect(first.avatarUrl).toContain('googleusercontent.com');
    expect(r.raw).not.toContain(sub);
    expect(r.raw).not.toContain('tan@example.com');
    expect(r.raw).not.toMatch(/p_[A-Za-z0-9]{20}/);
    // 会话 Cookie：HttpOnly + SameSite
    const sc = r.headers.getSetCookie().find((c) => c.startsWith('apc_sid='))!;
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    expect((await b.req('GET', '/api/player/me')).body.state.nickname).toBe('Tan Ah Kow');
  });

  it('测试 2 / 3：退出登录保留数据，重新登录完整恢复', async () => {
    const b = new Browser(srv.port);
    await b.googleLogin();
    expect((await b.req('PATCH', '/api/player/profile', { nickname: '狐狸先生', onboarded: true })).status).toBe(200);
    expect((await b.req('POST', '/api/auth/logout', {})).status).toBe(200);
    expect((await b.req('GET', '/api/player/me')).status).toBe(401);
    const again = await b.googleLogin();
    expect(again.body.state.isNew).toBe(false);
    expect(again.body.state.nickname).toBe('狐狸先生');
    expect(again.body.state.onboarded).toBe(true);
  });

  it('测试 4：换浏览器（新的 Cookie）→ 数据恢复', async () => {
    const other = new Browser(srv.port);
    const r = await other.googleLogin();
    expect(r.body.state.nickname).toBe('狐狸先生');
  });

  it('测试 6 / 7 / 9：服务器结算升级、解锁动物、成就，并推送到所有设备', { timeout: 30000 }, async () => {
    const mac = new Browser(srv.port);
    const phone = new Browser(srv.port);
    await mac.googleLogin();
    await phone.googleLogin();
    const phoneWs = await phone.ws();
    const c = await playSoloGame(mac);
    const progress = c.msgs.filter((m) => m.t === 'progress') as Extract<ServerMessage, { t: 'progress' }>[];
    const last = progress[progress.length - 1].state;
    expect(last.stats.handsPlayed).toBeGreaterThan(0);
    expect(last.stats.gamesPlayed).toBe(1);
    expect(last.stats.allIns).toBeGreaterThan(0);
    expect(last.achievements.first_hand).toBeTruthy();
    expect(last.achievements.first_allin).toBeTruthy();
    expect(last.level).toBeGreaterThanOrEqual(2);
    expect(last.unlockedAnimals).toContain('fox');
    expect(last.recent.length).toBe(1);
    // 手机同时在线：也收到了同样的结算
    await until(() => phoneWs.msgs.some((m) => m.t === 'progress' && (m as any).state.stats.gamesPlayed === 1));
    // 重新从服务器读取：已经保存
    const saved = (await phone.req('GET', '/api/player/me')).body.state as AccountState;
    expect(saved.level).toBe(last.level);
    expect(saved.xp).toBe(last.xp);
    expect(saved.chips).toBe(last.chips);
    expect(saved.chips).toBeGreaterThan(1000);
    expect(saved.unlockedAnimals).toContain('fox');
    // 牌桌上显示的是服务器上的真实资料，不是客户端自称的 99 级
    const welcome = c.msgs.find((m) => m.t === 'room' && m.room) as any;
    expect(welcome.room.members.find((m: any) => !m.isAI).profile.level).toBe(1);
    expect(welcome.room.members.find((m: any) => !m.isAI).profile.name).toBe('狐狸先生');
    expect(welcome.room.solo).toBe(true);
    c.ws.close();
    phoneWs.ws.close();
  });

  it('测试 8：修改动物外观 → 保存；未解锁的动物被拒绝', async () => {
    const b = new Browser(srv.port);
    await b.googleLogin();
    const fox = { ...DEFAULT_ANIMAL, species: 'fox', furColor: 'gold', hat: 'crown', glasses: 'shades', outfit: 'suit' };
    expect((await b.req('PATCH', '/api/player/profile', { animal: fox })).status).toBe(200);
    const dragon = await b.req('PATCH', '/api/player/profile', { animal: { ...DEFAULT_ANIMAL, species: 'dragon' } });
    expect(dragon.status).toBe(403);
    const other = new Browser(srv.port);
    const s = (await other.googleLogin()).body.state as AccountState;
    expect(s.animal.species).toBe('fox');
    expect(s.animal.hat).toBe('crown');
    expect(s.animal.furColor).toBe('gold');
  });

  it('测试 5：换设备（服务器重启后从数据库读取）→ 数据恢复', async () => {
    const before = (await (async () => {
      const b = new Browser(srv.port);
      await b.googleLogin();
      return (await b.req('GET', '/api/player/me')).body.state;
    })()) as AccountState;
    await srv.close();
    srv = await boot();
    const device = new Browser(srv.port);
    const after = (await device.googleLogin()).body.state as AccountState;
    expect(after.level).toBe(before.level);
    expect(after.xp).toBe(before.xp);
    expect(after.chips).toBe(before.chips);
    expect(after.animal).toEqual(before.animal);
    expect(after.achievements).toEqual(before.achievements);
    expect(after.stats).toEqual(before.stats);
  });

  it('测试 11：同一场 / 同一手重复结算 → 不能重复领奖', async () => {
    const b = new Browser(srv.port);
    await b.googleLogin({ sub: 'dup-user' });
    const me = await b.req('GET', '/api/player/me');
    const userId = (srv.accounts as any).db.prepare("SELECT user_id FROM auth_identities WHERE subject = 'dup-user'").get().user_id;
    const g = { place: 1, players: 4, hands: 10, finalChips: 4000, mode: 'local' as const };
    const e1 = srv.accounts!.recordGame(userId, 'room1:1', g);
    const e2 = srv.accounts!.recordGame(userId, 'room1:1', g);
    expect(e1).not.toBeNull();
    expect(e2).toBeNull();
    const h = { won: true, amount: 500, bet: 100, category: 1, allIn: false, folded: false, uncontested: false, species: 'cat' as const, online: false };
    const h1 = srv.accounts!.recordHand(userId, 'room1:1:1', h);
    expect(h1).not.toBeNull();
    expect(srv.accounts!.recordHand(userId, 'room1:1:1', h)).toBeNull();
    const s = srv.accounts!.getState(userId);
    expect(s.stats.gamesPlayed).toBe(1);
    expect(s.stats.handsPlayed).toBe(1);
    expect(s.chips).toBe(me.body.state.chips + e1!.chipsGained + h1!.chipsGained);
    expect(s.xp).toBe(me.body.state.xp + e1!.xpGained + h1!.xpGained);
  });

  it('测试 12：恶意修改客户端数据 → 服务器拒绝', async () => {
    const b = new Browser(srv.port);
    await b.googleLogin();
    for (const evil of [{ level: 99 }, { chips: 999999999 }, { xp: 999999 }, { virtualChips: 1 }, { isAdmin: true }, { achievements: { royal: 1 } }]) {
      expect((await b.req('PATCH', '/api/player/profile', evil)).status).toBe(400);
    }
    expect((await b.req('POST', '/api/player/reward', { chips: 999999999, xp: 999999999 })).status).toBe(404);
    expect((await b.req('POST', '/api/player/game-result', { place: 1 })).status).toBe(404);
    for (const bad of ['管理员', 'Admin', '系统消息', 'x', '一二三四五六七八九十一二三', '<script>', 'GM']) {
      expect((await b.req('PATCH', '/api/player/profile', { nickname: bad })).status).toBe(400);
    }
    // 跨站请求被拒绝
    expect((await b.req('PATCH', '/api/player/profile', { nickname: '好名字' }, { origin: 'https://evil.example' })).status).toBe(403);
    // 伪造 / 篡改的 Google 令牌全部失败，并且只显示通用提示
    const fresh = new Browser(srv.port);
    const cases = [
      await fresh.googleLogin({}, evilKey),
      await fresh.googleLogin({ aud: 'someone-else' }),
      await fresh.googleLogin({ iss: 'https://evil.example' }),
      await fresh.googleLogin({ exp: Math.floor(Date.now() / 1000) - 3600 }),
      await fresh.req('POST', '/api/auth/google', { credential: idToken({ nonce: 'wrong' }) }),
      await fresh.req('POST', '/api/auth/google', { credential: 'not-a-token' }),
    ];
    for (const r of cases) {
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('登录失败，请重新尝试。');
    }
    expect((await fresh.req('GET', '/api/player/me')).status).toBe(401);
    // 未登录不能访问玩家接口；开发测试登录在此配置下不存在
    expect((await new Browser(srv.port).req('GET', '/api/player/progress')).status).toBe(401);
    expect((await new Browser(srv.port).req('POST', '/api/auth/dev', { name: 'x' })).status).toBe(404);
  });

  it('游客数据迁移：只迁移一次、经验封顶、成就由服务器重新判定', async () => {
    const b = new Browser(srv.port);
    await b.googleLogin({ sub: 'guest-migrant', name: 'Lee' });
    const guest = {
      name: '小橘',
      animal: { ...DEFAULT_ANIMAL, species: 'rabbit' },
      xp: 999_999_999,
      stats: { handsPlayed: 40, handsWon: 99, gamesPlayed: 5, gamesWon: 2, biggestPot: 3000, bestHand: 9, bestStreak: 4, currentStreak: 2, allInWins: 1, speciesWins: { rabbit: 30 } },
      achievements: { royal: 1, champion: 1, hands100: 1 },
      characters: [{ id: 'abc123', name: '兔兔', animal: { ...DEFAULT_ANIMAL, species: 'rabbit' }, createdAt: 1 }],
      settings: { quality: 'low', musicVolume: 0.2 },
    };
    const r = await b.req('POST', '/api/player/migrate-guest', { guest });
    expect(r.body.migrated).toBe(true);
    const s = r.body.state as AccountState;
    expect(levelFromXp(GUEST_LIMITS.maxXp)).toBe(10);
    expect(s.level).toBeLessThanOrEqual(11);
    expect(s.stats.handsWon).toBeLessThanOrEqual(s.stats.handsPlayed);
    expect(s.achievements.hands100).toBeUndefined();
    expect(s.nickname).toBe('小橘');
    expect(s.animal.species).toBe('rabbit');
    expect(s.characters.map((c) => c.id)).toContain('abc123');
    expect(s.settings.quality).toBe('low');
    const again = await b.req('POST', '/api/player/migrate-guest', { guest });
    expect(again.body.migrated).toBe(false);
    expect(again.body.state.xp).toBe(s.xp);
  });

  it('测试 10：网络断开 / 数据库异常 → 不损坏数据，不暴露技术细节', async () => {
    const b = new Browser(srv.port);
    await b.googleLogin({ sub: 'flaky' });
    const before = (await b.req('GET', '/api/player/me')).body.state as AccountState;
    // 打到一半断线，再用同一个会话重连
    const c = await b.ws();
    c.send({ t: 'startSolo', settings: { opponents: [{ personality: 'cautiousPanda', difficulty: 'easy' }], startingChips: 1000, smallBlind: 10, bigBlind: 20 } });
    await until(() => c.msgs.some((m) => m.t === 'state' && (m as any).view.handNumber >= 1));
    const sessionId = (c.msgs.find((m) => m.t === 'welcome') as any).sessionId;
    c.ws.close();
    await new Promise((r) => setTimeout(r, 300));
    const ws2 = new WebSocket(`ws://localhost:${srv.port}/ws`, { headers: { cookie: b.cookieHeader } });
    const msgs: ServerMessage[] = [];
    ws2.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws2.on('open', () => r()));
    ws2.send(JSON.stringify({ t: 'hello', sessionId, profile: { name: 'x', animal: DEFAULT_ANIMAL } }));
    await until(() => msgs.some((m) => m.t === 'room' && (m as any).room?.solo));
    ws2.close();
    const after = (await b.req('GET', '/api/player/me')).body.state as AccountState;
    expect(after.chips).toBeGreaterThanOrEqual(before.chips);
    expect(after.xp).toBeGreaterThanOrEqual(before.xp);
    expect(after.stats.handsWon).toBeLessThanOrEqual(after.stats.handsPlayed);

    // 数据库暂时不可用：返回通用提示，玩家数据保持不变
    const orig = srv.accounts!.getState.bind(srv.accounts);
    (srv.accounts as any).getState = () => {
      throw new Error('SQLITE_BUSY: database is locked at /secret/path.ts:42');
    };
    const fail = await b.req('GET', '/api/player/me');
    (srv.accounts as any).getState = orig;
    expect(fail.status).toBe(503);
    expect(fail.body.error).toBe('服务器暂时无法同步你的资料，请稍后再试。');
    expect(fail.raw).not.toContain('SQLITE');
    expect(fail.raw).not.toContain('secret');
    const ok = (await b.req('GET', '/api/player/me')).body.state as AccountState;
    expect(ok.chips).toBe(after.chips);
  });

  it('多设备冲突：旧版本的修改被拒绝并返回最新数据；进度只能由服务器写入', async () => {
    const mac = new Browser(srv.port);
    const phone = new Browser(srv.port);
    await mac.googleLogin({ sub: 'multi' });
    await phone.googleLogin({ sub: 'multi' });
    const v = (await mac.req('GET', '/api/player/me')).body.state.version;
    expect((await mac.req('PATCH', '/api/player/profile', { nickname: '麦克', baseVersion: v })).status).toBe(200);
    const stale = await phone.req('PATCH', '/api/player/profile', { nickname: '手机', baseVersion: v });
    expect(stale.status).toBe(409);
    expect(stale.body.state.nickname).toBe('麦克');
    expect((await phone.req('PATCH', '/api/player/profile', { nickname: '手机', baseVersion: stale.body.state.version })).status).toBe(200);
  });

  it('设置跨设备同步，非法设置值被过滤', async () => {
    const a = new Browser(srv.port);
    await a.googleLogin({ sub: 'settings' });
    await a.req('PATCH', '/api/player/settings', { settings: { quality: 'ultra', musicVolume: 0.5, room: 'cabin', evil: 1, sfxVolume: 50 } });
    const b = new Browser(srv.port);
    const s = (await b.googleLogin({ sub: 'settings' })).body.state as AccountState;
    expect(s.settings).toEqual({ quality: 'ultra', musicVolume: 0.5, room: 'cabin' });
  });

  it('删除账号：需要确认；删除后所有数据与会话被清除', async () => {
    const b = new Browser(srv.port);
    await b.googleLogin({ sub: 'leaver' });
    const other = new Browser(srv.port);
    await other.googleLogin({ sub: 'leaver' });
    expect((await b.req('DELETE', '/api/player/account', {})).status).toBe(400);
    expect((await b.req('DELETE', '/api/player/account', { confirm: '删除账号' })).status).toBe(200);
    expect((await b.req('GET', '/api/player/me')).status).toBe(401);
    expect((await other.req('GET', '/api/player/me')).status).toBe(401);
    const db = (srv.accounts as any).db;
    expect(db.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE subject = 'leaver'").get().n).toBe(0);
    const again = await b.googleLogin({ sub: 'leaver' });
    expect(again.body.state.isNew).toBe(true);
    expect(again.body.state.level).toBe(1);
  });
});

describe('正式环境安全设置', () => {
  it('正式环境：测试登录永远关闭，会话 Cookie 带 Secure', async () => {
    const prod = await createServer(0, { dbPath: ':memory:', google: { clientId: CLIENT_ID, fetchJwks }, devLogin: true, production: true });
    try {
      const b = new Browser(prod.port);
      expect((await b.req('GET', '/api/auth/config')).body.devLogin).toBe(false);
      expect((await b.req('POST', '/api/auth/dev', { name: 'x' })).status).toBe(404);
      const r = await b.googleLogin();
      expect(r.status).toBe(200);
      const sc = r.headers.getSetCookie().find((c) => c.startsWith('apc_sid='))!;
      expect(sc).toContain('Secure');
      expect(sc).toContain('HttpOnly');
    } finally {
      await prod.close();
    }
  });
});
