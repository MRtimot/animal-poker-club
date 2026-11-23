// 浏览器存储损坏 / 旧版本 / 未来版本：在读取阶段就不能让游戏崩溃；永久存档不会被整体清空
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const g = globalThis as any;
g.window ??= globalThis;
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
};

async function load(profile: string | null, settings: string | null) {
  vi.resetModules();
  g.localStorage = mem();
  g.sessionStorage = mem();
  if (profile !== null) g.localStorage.setItem('apc-profile', profile);
  if (settings !== null) g.localStorage.setItem('apc-settings', settings);
  const { useProfile } = await import('../src/store/profileStore');
  const { useSettings } = await import('../src/store/settingsStore');
  await new Promise((r) => setTimeout(r, 10));
  return { p: useProfile.getState(), s: useSettings.getState(), useProfile, useSettings };
}

const QUALITIES = ['low', 'medium', 'high', 'ultra'];

describe('读取阶段的存储损坏', () => {
  beforeEach(() => vi.resetModules());

  it('无效 JSON / null / 空字符串：使用默认值，不抛错；之后的保存写回合法 JSON', async () => {
    for (const raw of ['{oops', 'null', '', 'undefined', '[]', '"text"', '{"state":null,"version":2}']) {
      const { p, s, useProfile } = await load(raw, raw);
      expect(p.animal.species, raw).toBe('cat');
      expect(Array.isArray(p.characters)).toBe(true);
      expect(Number.isFinite(p.xp)).toBe(true);
      expect(QUALITIES).toContain(s.quality);
      useProfile.getState().setName('恢复了');
      const saved = JSON.parse(g.localStorage.getItem('apc-profile'));
      expect(saved.state.name).toBe('恢复了');
    }
  });

  it('字段类型错误（“coins: banana”这类）：逐项回落到合法值', async () => {
    const { p, s } = await load(
      JSON.stringify({ state: { name: 42, xp: 'banana', level: null, achievements: 'x', characters: 'y', recent: { a: 1 }, stats: null, animal: { species: 'unicorn' } }, version: 2 }),
      JSON.stringify({ state: { quality: 'banana', musicVolume: 'loud', sfxVolume: 7, autoCamera: 'yes', voiceRate: 99, room: 'moon', serverUrl: 123 }, version: 2 }),
    );
    expect(typeof p.name).toBe('string');
    expect(p.xp).toBe(0);
    expect(p.achievements).toEqual({});
    expect(p.characters).toEqual([]);
    expect(p.recent).toEqual([]);
    expect(p.animal.species).toBe('cat');
    expect(QUALITIES).toContain(s.quality);
    expect(s.musicVolume).toBeGreaterThanOrEqual(0);
    expect(s.musicVolume).toBeLessThanOrEqual(1);
    expect(s.sfxVolume).toBeLessThanOrEqual(1);
    expect(typeof s.autoCamera).toBe('boolean');
    expect(s.voiceRate).toBeLessThanOrEqual(1.6);
    expect(['casino', 'penthouse', 'cabin']).toContain(s.room);
    expect(typeof s.serverUrl).toBe('string');
  });

  it('旧版本（v1）存档迁移后保留进度；未来版本（v99）也不会崩溃', async () => {
    const v1 = await load(JSON.stringify({ state: { name: '老玩家', xp: 1234, stats: { handsPlayed: 50, handsWon: 12 }, achievements: { first_win: 5 } }, version: 1 }), null);
    expect(v1.p.name).toBe('老玩家');
    expect(v1.p.xp).toBe(1234);
    expect(v1.p.stats.handsPlayed).toBe(50);
    expect(v1.p.stats.folds).toBe(0); // 新增字段被补齐
    expect(v1.p.achievements).toEqual({ first_win: 5 });
    const future = await load(JSON.stringify({ state: { name: '未来', xp: 9, newThing: { deep: true } }, version: 99 }), JSON.stringify({ state: { quality: 'low' }, version: 99 }));
    expect(future.p.name).toBe('未来');
    expect(future.p.xp).toBe(9);
    expect(future.s.quality).toBe('low');
  });
});

describe('永久存档不会被整体清空', () => {
  it('代码里没有 localStorage.clear() / sessionStorage.clear()（返回首页、结束对局只清理自己的临时状态）', () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
    const offenders = walk(path.join(__dirname, '..', 'src')).filter((f) => /(localStorage|sessionStorage)\.clear\(/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('STORE-01 多个标签页共用游客存档 / 设置', () => {
  it('另一个标签页写入后，本标签页重新读取：之后的保存不会把对方刚获得的经验 / 改动覆盖回去；读取不会额外写入探测键', async () => {
    // 让 window 能真正派发事件（模拟浏览器的 storage 事件）
    const et = new EventTarget();
    g.addEventListener = et.addEventListener.bind(et);
    g.removeEventListener = et.removeEventListener.bind(et);
    const { useProfile, useSettings } = await load(JSON.stringify({ state: { name: '标签A', xp: 100 }, version: 2 }), null);
    expect(useProfile.getState().xp).toBe(100);
    // 另一个标签页：获得经验并保存、修改了音乐音量
    g.localStorage.setItem('apc-profile', JSON.stringify({ state: { ...JSON.parse(g.localStorage.getItem('apc-profile')).state, xp: 450 }, version: 2 }));
    g.localStorage.setItem('apc-settings', JSON.stringify({ state: { ...useSettings.getState(), set: undefined, musicVolume: 0.1 }, version: 2 }));
    for (const key of ['apc-profile', 'apc-settings']) et.dispatchEvent(Object.assign(new Event('storage'), { key }));
    await new Promise((r) => setTimeout(r, 10));
    expect(useProfile.getState().xp).toBe(450);
    expect(useSettings.getState().musicVolume).toBe(0.1);
    // 本标签页之后的改动：保存的存档同时包含两边的进度
    useProfile.getState().setName('标签A改名');
    const saved = JSON.parse(g.localStorage.getItem('apc-profile')).state;
    expect(saved.xp).toBe(450);
    expect(saved.name).toBe('标签A改名');
    // 探测键只写一次（不会每次读写存档都写入再删除）
    const writes: string[] = [];
    const orig = g.localStorage.setItem;
    g.localStorage.setItem = (k: string, v: string) => (writes.push(k), orig(k, v));
    for (let i = 0; i < 5; i++) useProfile.getState().setName('第' + i + '次');
    g.localStorage.setItem = orig;
    expect(writes.filter((k) => k === '__apc_test__')).toEqual([]);
    expect(writes.filter((k) => k === 'apc-profile').length).toBe(5);
    g.addEventListener = () => {};
    g.removeEventListener = () => {};
  });
});

describe('COOKIE-01 Cookie 与本机存储同意：选择真正生效', () => {
  it('还没选择：照常保存设置；选择“仅必要”：删除已保存的设置且之后不再写入；重新允许：写回当前设置；选择被记住（带版本与时间）', async () => {
    const { useSettings } = await load(null, null);
    const consent = await import('../src/privacy/consent');
    expect(consent.useConsent.getState().consent).toBeNull();
    expect(consent.preferencesAllowed()).toBe(true);
    useSettings.getState().set({ musicVolume: 0.2 });
    expect(JSON.parse(g.localStorage.getItem('apc-settings')).state.musicVolume).toBe(0.2);
    // 仅必要
    const c = consent.saveConsent({ preferences: false });
    expect(c).toMatchObject({ version: consent.CONSENT_VERSION, essential: true, preferences: false, analytics: false });
    expect(typeof c.timestamp).toBe('number');
    expect(g.localStorage.getItem('apc-settings')).toBeNull();
    useSettings.getState().set({ musicVolume: 0.7 });
    expect(useSettings.getState().musicVolume).toBe(0.7); // 本次打开期间仍然有效
    expect(g.localStorage.getItem('apc-settings')).toBeNull(); // 但不写入本机
    // 选择被保存，重新打开页面后仍然有效
    expect(consent.parseConsent(g.localStorage.getItem('apc-consent'))?.preferences).toBe(false);
    // 重新允许：当前设置写回
    consent.saveConsent({ preferences: true });
    expect(JSON.parse(g.localStorage.getItem('apc-settings')).state.musicVolume).toBe(0.7);
  });

  it('同意记录损坏 / 旧版本：视为还没选择（重新询问），不会崩溃', async () => {
    await load(null, null);
    const { parseConsent, CONSENT_VERSION } = await import('../src/privacy/consent');
    for (const bad of [null, '', '{oops', 'null', '[]', JSON.stringify({ version: CONSENT_VERSION - 1, preferences: true, timestamp: 1 }), JSON.stringify({ version: CONSENT_VERSION, preferences: 'yes', timestamp: 1 })])
      expect(parseConsent(bad as any)).toBeNull();
    expect(parseConsent(JSON.stringify({ version: CONSENT_VERSION, preferences: false, timestamp: 5, analytics: true }))).toEqual({ version: CONSENT_VERSION, essential: true, preferences: false, analytics: false, timestamp: 5 });
  });
});
