// 手机全屏管理：能力检测、进入 / 退出 / 切换、系统退出同步、偏好（自动 / 开 / 关）、失败回退、监听不重复
// 浏览器环境用一个最小的假 document / window 模拟（真实手机浏览器的表现见报告中的“未验证”部分）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';

const settings = { fullscreenPreference: 'auto' as 'auto' | 'on' | 'off', haptics: true };
let pc = false;
vi.mock('../src/store/settingsStore', () => ({ useSettings: { getState: () => settings } }));
vi.mock('../src/utils/pc', () => ({ isPC: () => pc }));

type Fake = ReturnType<typeof setup>;
function setup(o: { supported?: boolean; webkitOnly?: boolean; reject?: boolean; standalone?: boolean } = {}) {
  const { supported = true, webkitOnly = false, reject = false, standalone = false } = o;
  const listeners = new Map<string, Set<() => void>>();
  const fire = (t: string) => listeners.get(t)?.forEach((f) => f());
  const classes = new Set<string>();
  const el: any = { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)), contains: (c: string) => classes.has(c) } };
  const doc: any = {
    documentElement: el,
    addEventListener: (t: string, f: () => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(f);
    },
    removeEventListener: (t: string, f: () => void) => listeners.get(t)?.delete(f),
  };
  const requests = { count: 0 };
  if (supported && webkitOnly) {
    doc.webkitFullscreenEnabled = true;
    doc.webkitFullscreenElement = null;
    el.webkitRequestFullscreen = () => {
      requests.count++;
      doc.webkitFullscreenElement = el;
      fire('webkitfullscreenchange');
    };
    doc.webkitExitFullscreen = () => {
      doc.webkitFullscreenElement = null;
      fire('webkitfullscreenchange');
    };
  } else if (supported) {
    doc.fullscreenEnabled = true;
    doc.fullscreenElement = null;
    el.requestFullscreen = async () => {
      requests.count++;
      if (reject) throw new TypeError('Permissions check failed');
      doc.fullscreenElement = el;
      fire('fullscreenchange');
    };
    doc.exitFullscreen = async () => {
      doc.fullscreenElement = null;
      fire('fullscreenchange');
    };
  } else {
    doc.fullscreenEnabled = false;
  }
  (globalThis as any).document = doc;
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.matchMedia = (q: string) => ({ matches: standalone && q.includes('standalone') });
  /** 系统手势 / 返回键退出全屏（不经过游戏的按钮） */
  const systemExit = () => {
    if (webkitOnly) doc.webkitFullscreenElement = null;
    else doc.fullscreenElement = null;
    fire(webkitOnly ? 'webkitfullscreenchange' : 'fullscreenchange');
  };
  return { doc, el, classes, listeners, requests, systemExit };
}

async function load() {
  return import('../src/display/fullscreen');
}

let f: Fake;
beforeEach(() => {
  vi.resetModules();
  settings.fullscreenPreference = 'auto';
  pc = false;
  delete (globalThis as any).window?.__apcFullscreen;
});

describe('全屏管理', () => {
  it('FS-01 不支持网页全屏（例如 iPhone 浏览器）：不报错，进入沉浸浏览模式，不假装已经全屏', async () => {
    f = setup({ supported: false });
    const m = await load();
    expect(m.isSupported()).toBe(false);
    expect(m.displayMode()).toBe('immersive-fallback');
    expect(f.classes.has('apc-immersive')).toBe(true);
    expect(f.classes.has('apc-fullscreen')).toBe(false);
    expect(await m.enter()).toBe(false);
    // 不假装已经全屏
    expect(m.isFullscreen()).toBe(false);
    expect(m.useFullscreen.getState().notice?.kind).toBe('immersive');
    // “关”：不请求全屏，普通页面
    settings.fullscreenPreference = 'off';
    expect(m.displayMode()).toBe('browser');
    settings.fullscreenPreference = 'on';
    expect(m.displayMode()).toBe('immersive-fallback');
    settings.fullscreenPreference = 'auto';
    // 进入游戏的按钮：静默跳过（不提示、不报错）
    m.useFullscreen.setState({ notice: null });
    m.enterOnEntryGesture();
    expect(m.useFullscreen.getState().notice).toBe(null);
  });

  it('FS-02 进入 / 退出 / 切换：状态以浏览器的 fullscreenchange 为准，进入时短暂提示', async () => {
    f = setup();
    const m = await load();
    expect(m.displayMode()).toBe('browser');
    expect(await m.enter()).toBe(true);
    expect(m.isFullscreen()).toBe(true);
    expect(f.classes.has('apc-fullscreen')).toBe(true);
    expect(m.useFullscreen.getState().notice?.kind).toBe('entered');
    expect(m.displayMode()).toBe('native-fullscreen');
    await m.toggle();
    expect(m.isFullscreen()).toBe(false);
    expect(f.classes.has('apc-fullscreen')).toBe(false);
    await m.toggle();
    expect(m.isFullscreen()).toBe(true);
    // 已经全屏时再次进入不会重复请求
    const n = f.requests.count;
    await m.enter();
    expect(f.requests.count).toBe(n);
  });

  it('FS-03 系统手势退出：界面立即知道；“自动”本次不再自动进入，“开”在下一次点击进入游戏时才进入', async () => {
    f = setup();
    const m = await load();
    m.enterOnEntryGesture();
    await Promise.resolve();
    expect(m.isFullscreen()).toBe(true);
    f.systemExit();
    expect(m.isFullscreen()).toBe(false);
    expect(m.useFullscreen.getState().declined).toBe(true);
    // 退出后不会自己重新进入
    await Promise.resolve();
    expect(m.isFullscreen()).toBe(false);
    m.enterOnEntryGesture();
    await Promise.resolve();
    expect(m.isFullscreen()).toBe(false);
    settings.fullscreenPreference = 'on';
    m.enterOnEntryGesture();
    await Promise.resolve();
    expect(m.isFullscreen()).toBe(true);
  });

  it('FS-04 “关”、电脑版、已经以应用方式打开时：进入游戏不会进入全屏', async () => {
    f = setup();
    let m = await load();
    settings.fullscreenPreference = 'off';
    m.enterOnEntryGesture();
    pc = true;
    settings.fullscreenPreference = 'on';
    m.enterOnEntryGesture();
    await Promise.resolve();
    expect(f.requests.count).toBe(0);
    vi.resetModules();
    pc = false;
    f = setup({ standalone: true });
    m = await load();
    expect(m.displayMode()).toBe('standalone-pwa');
    m.enterOnEntryGesture();
    expect(f.requests.count).toBe(0);
  });

  it('FS-05 浏览器拒绝请求：不抛出错误、不刷错误日志，继续游戏；“自动”不再反复尝试', async () => {
    f = setup({ reject: true });
    const m = await load();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.enterOnEntryGesture();
    await new Promise((r) => setTimeout(r, 0));
    expect(m.isFullscreen()).toBe(false);
    expect(m.useFullscreen.getState().failed).toBe(true);
    expect(m.useFullscreen.getState().notice).toBe(null);
    // 被拒绝后本次使用沉浸式显示（不是“全屏”，也不是坏掉）
    expect(m.displayMode()).toBe('immersive-fallback');
    expect(f.classes.has('apc-immersive')).toBe(true);
    m.enterOnEntryGesture();
    expect(f.requests.count).toBe(1);
    // 手动点“进入全屏”失败时才提示
    expect(await m.enter(true)).toBe(false);
    expect(m.useFullscreen.getState().notice?.kind).toBe('immersive');
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('FS-09 能力检测必须同时满足“允许全屏”和“方法存在”：只有其中一个时按不支持处理（沉浸式显示）', async () => {
    f = setup();
    f.doc.fullscreenEnabled = true;
    delete f.el.requestFullscreen;
    let m = await load();
    expect(m.isSupported()).toBe(false);
    expect(m.displayMode()).toBe('immersive-fallback');
    vi.resetModules();
    f = setup();
    f.doc.fullscreenEnabled = false;
    m = await load();
    expect(m.isSupported()).toBe(false);
    m.enterOnEntryGesture();
    expect(f.requests.count).toBe(0);
  });

  it('FS-10 安卓返回键：全屏时或刚退出全屏时的“返回”只用来退出全屏（不离开房间、不回首页）；平时的返回照常处理', async () => {
    f = setup();
    const m = await load();
    expect(m.consumeBackForFullscreen()).toBe(false);
    await m.enter();
    // 浏览器先触发历史返回、仍在全屏：退出全屏并留在当前页面
    expect(m.consumeBackForFullscreen()).toBe(true);
    await Promise.resolve();
    expect(m.isFullscreen()).toBe(false);
    // 浏览器先退出全屏、紧接着触发历史返回：同样只退出全屏
    await m.enter();
    f.systemExit();
    expect(m.consumeBackForFullscreen()).toBe(true);
    // 过一会儿以后的返回：正常导航
    const t = performance.now();
    const spy = vi.spyOn(performance, 'now').mockReturnValue(t + 2000);
    expect(m.consumeBackForFullscreen()).toBe(false);
    spy.mockRestore();
  });

    it('FS-06 只有带 webkit 前缀的接口（旧版 Safari）：按能力检测使用', async () => {
    f = setup({ webkitOnly: true });
    const m = await load();
    expect(m.isSupported()).toBe(true);
    expect(await m.enter()).toBe(true);
    expect(m.isFullscreen()).toBe(true);
    f.systemExit();
    expect(m.isFullscreen()).toBe(false);
  });

  it('FS-07 监听只安装一次：模块重新加载（热更新）后每种事件仍只有一个监听，反复进入 / 退出 10 次不增加', async () => {
    f = setup();
    await load();
    vi.resetModules();
    const m = await load();
    for (const t of ['fullscreenchange', 'webkitfullscreenchange', 'fullscreenerror', 'webkitfullscreenerror']) expect(f.listeners.get(t)?.size).toBe(1);
    for (let i = 0; i < 10; i++) {
      await m.enter();
      await m.exit();
    }
    expect(m.isFullscreen()).toBe(false);
    for (const t of ['fullscreenchange', 'webkitfullscreenchange']) expect(f.listeners.get(t)?.size).toBe(1);
  });

  it('FS-08 只在玩家点击时请求全屏：不在加载、计时器或 useEffect 里调用；进入游戏的按钮都接入了统一的入口', () => {
    const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
    const mgr = read('../src/display/fullscreen.ts');
    expect(mgr).not.toMatch(/setTimeout|setInterval/);
    // 只有全屏管理直接调用浏览器的全屏 API
    for (const p of ['../src/App.tsx', '../src/ui/common/FullscreenUI.tsx', '../src/ui/home/HomeScreen.tsx', '../src/ui/lobby/RoomLobby.tsx', '../src/ui/lobby/OnlineScreen.tsx', '../src/ui/home/HubScreen.tsx', '../src/ui/game/hud/GameTopBar.tsx'])
      expect(read(p)).not.toMatch(/requestFullscreen|exitFullscreen/);
    const calls: [string, number][] = [
      // 4 个德州 / 在线入口 + 首页的 21 点、百家乐入口
      ['../src/ui/home/HomeScreen.tsx', 6],
      ['../src/ui/lobby/OnlineScreen.tsx', 2],
      ['../src/ui/lobby/RoomLobby.tsx', 1],
      ['../src/ui/home/HubScreen.tsx', 1],
      ['../src/ui/blackjack/BlackjackSetup.tsx', 1],
      ['../src/ui/baccarat/BaccaratSetup.tsx', 1],
    ];
    for (const [p, n] of calls) {
      const src = read(p);
      expect((src.match(/enterOnEntryGesture\(\)/g) ?? []).length).toBe(n);
      // 不在 useEffect 里调用
      for (const m of src.matchAll(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[/g)) expect(m[0]).not.toMatch(/enterOnEntryGesture/);
    }
    expect(read('../src/App.tsx')).not.toMatch(/enterOnEntryGesture|location\.reload/);
  });
});
