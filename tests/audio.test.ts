// 手机音频：解锁、唯一的 AudioContext、前后台、拒绝恢复、静音、离开牌桌、监听只注册一次
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ACTIVE_SOURCES, SoundEngine, VOICE_DUCK, sound } from '../src/audio/sound';
import { ACTIVATION_EVENTS, installAudioLifecycle, isActivation } from '../src/audio/audioLifecycle';
import { BrowserVoiceEngine, voice, type VoiceEnv } from '../src/audio/voice';
import { VOICE_PROFILES } from '../src/core/character/voice';
import { useSettings } from '../src/store/settingsStore';

const param = () => {
  const p: any = { value: 0, target: 0 };
  p.setTargetAtTime = (v: number) => void (p.target = v);
  for (const k of ['setValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues']) p[k] = () => undefined;
  return p;
};

/** 假的 AudioContext：mode 决定 resume() 的行为 */
class FakeCtx {
  state: string = 'suspended';
  currentTime = 10;
  sampleRate = 100;
  destination = {};
  onstatechange: (() => void) | null = null;
  mode: 'ok' | 'reject' | 'hang' | 'throw' = 'ok';
  nodes: any[] = [];
  private go(s: string) {
    this.state = s;
    this.onstatechange?.();
  }
  resume() {
    if (this.mode === 'throw') throw new Error('InvalidStateError');
    if (this.mode === 'reject') return Promise.reject(new DOMException('no', 'NotAllowedError'));
    if (this.mode === 'hang') return new Promise<void>(() => undefined);
    return Promise.resolve().then(() => this.go('running'));
  }
  suspend() {
    return Promise.resolve().then(() => this.go('suspended'));
  }
  close() {
    return Promise.resolve();
  }
  set(s: string) {
    this.go(s);
  }
  private node() {
    const n: any = { gain: param(), frequency: param(), Q: param(), detune: param(), threshold: param(), ratio: param(), attack: param(), release: param(), pan: param(), playbackRate: param(), start: () => undefined, stop: vi.fn(), disconnect: () => undefined, onended: null };
    n.connect = (d: any) => d;
    this.nodes.push(n);
    return n;
  }
  createGain() { return this.node(); }
  createDynamicsCompressor() { return this.node(); }
  createConvolver() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createOscillator() { return this.node(); }
  createBufferSource() { return this.node(); }
  createStereoPanner() { return this.node(); }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
}

function engine(mode: FakeCtx['mode'] = 'ok') {
  const e = new SoundEngine();
  const ctxs: FakeCtx[] = [];
  e.createContext = () => {
    const c = new FakeCtx();
    c.mode = mode;
    ctxs.push(c);
    return c as any;
  };
  return { e, ctxs };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  useSettings.setState({ muted: false, musicVolume: 0.35 });
  vi.useRealTimers();
});

describe('音频状态机', () => {
  it('AUD-01 加载时不创建 AudioContext；第一次手势 → ready；之后再点也只有一个', async () => {
    const { e, ctxs } = engine();
    e.prepare();
    expect(e.status).toBe('locked');
    expect(ctxs.length).toBe(0);
    e.unlock();
    expect(e.status).toBe('initializing');
    await flush();
    expect(e.status).toBe('ready');
    for (let i = 0; i < 20; i++) e.unlock();
    expect(ctxs.length).toBe(1);
    expect(e.contextsCreated).toBe(1);
  });

  it.each(['reject', 'hang', 'throw'] as const)('AUD-02 浏览器拒绝恢复（%s）：不抛错，回到 locked，下一次手势成功', async (mode) => {
    const { e, ctxs } = engine(mode);
    expect(() => e.unlock()).not.toThrow();
    await flush();
    vi.advanceTimersByTime(800);
    expect(e.status).toBe('locked');
    ctxs[0].mode = 'ok';
    e.unlock();
    await flush();
    expect(e.status).toBe('ready');
    expect(ctxs.length).toBe(1);
  });

  it('AUD-03 没有 Web Audio / 创建失败：error，所有声音调用都安全', () => {
    const e = new SoundEngine();
    e.createContext = () => { throw new Error('x'); };
    e.unlock();
    expect(e.status).toBe('error');
    expect(() => { e.play('chip'); e.cineImpact(); e.startMusic(); e.stopTransient(); e.suspendForBackground(); e.resumeForForeground(); }).not.toThrow();
    e.stopMusic();
  });

  it('AUD-04 后台暂停、前台恢复；后台期间不会被手势以外的东西唤醒', async () => {
    const { e, ctxs } = engine();
    e.unlock();
    await flush();
    e.suspendForBackground();
    await flush();
    expect([e.status, ctxs[0].state]).toEqual(['suspended', 'suspended']);
    e.unlock();
    expect(ctxs[0].state).toBe('suspended');
    e.resumeForForeground();
    expect(e.status).toBe('resuming');
    await flush();
    expect(e.status).toBe('ready');
  });

  it('AUD-05 快速切出又切回（suspend 还没完成）：最后一定在播放', async () => {
    const { e, ctxs } = engine();
    e.unlock();
    await flush();
    e.suspendForBackground();
    e.resumeForForeground();
    await flush();
    vi.advanceTimersByTime(1000);
    expect([e.status, ctxs[0].state]).toEqual(['ready', 'running']);
  });

  it('AUD-06 iOS interrupted（来电等）→ locked，手势里恢复', async () => {
    const { e, ctxs } = engine();
    e.unlock();
    await flush();
    ctxs[0].set('interrupted');
    expect(e.status).toBe('locked');
    expect(e.everReady).toBe(true);
    e.unlock();
    await flush();
    expect(e.status).toBe('ready');
  });
});

describe('混音 / 静音 / 节点', () => {
  it('AUD-07 全部静音立即生效，取消后恢复；静音时音乐不创建节点', async () => {
    const { e, ctxs } = engine();
    e.unlock();
    await flush();
    useSettings.setState({ muted: true });
    e.applyVolumes();
    expect((e.master.gain as any).target).toBe(0);
    const before = ctxs[0].nodes.length;
    e.startMusic();
    vi.advanceTimersByTime(300);
    ctxs[0].currentTime += 2;
    vi.advanceTimersByTime(300);
    expect(ctxs[0].nodes.length - before).toBeLessThan(5); // 只有环境底噪的 3 个节点
    useSettings.setState({ muted: false });
    e.applyVolumes();
    expect((e.master.gain as any).target).toBeGreaterThan(0.5);
    e.dispose();
  });

  it('AUD-08 重复 startMusic 只有一个计时器（不会有两份 BGM）', async () => {
    const { e } = engine();
    e.unlock();
    await flush();
    const n = vi.getTimerCount();
    e.startMusic();
    const one = vi.getTimerCount();
    for (let i = 0; i < 10; i++) e.startMusic();
    expect(vi.getTimerCount()).toBe(one);
    expect(one - n).toBeLessThanOrEqual(2); // 音乐 + 环境声
    e.dispose();
  });

  it('AUD-09 角色说话压低音乐，说完恢复；演出混音同时有效', async () => {
    const { e } = engine();
    e.unlock();
    await flush();
    const m = () => (e.music.gain as any).target;
    e.applyVolumes();
    const normal = m();
    e.setVoiceDuck(true);
    expect(m()).toBeCloseTo(normal * VOICE_DUCK.music);
    e.setMix({ music: 0.2, ambient: 1, sfx: 1 });
    expect(m()).toBeCloseTo(normal * 0.2 * VOICE_DUCK.music);
    e.setVoiceDuck(false);
    e.resetMix();
    expect(m()).toBeCloseTo(normal);
  });

  it('AUD-10 连续压低：前一个计时不会提前恢复', async () => {
    const { e } = engine();
    e.unlock();
    await flush();
    e.applyVolumes();
    const normal = (e.music.gain as any).target;
    e.duck(0.3, 500);
    vi.advanceTimersByTime(400);
    e.duck(0.4, 1000);
    vi.advanceTimersByTime(300);
    expect((e.music.gain as any).target).toBeCloseTo(normal * 0.4);
    vi.advanceTimersByTime(800);
    expect((e.music.gain as any).target).toBeCloseTo(normal);
  });

  it('AUD-11 离开牌桌：演出声音全部停止，混音恢复', async () => {
    const { e, ctxs } = engine();
    e.unlock();
    await flush();
    const before = ctxs[0].nodes.length;
    e.setMix({ music: 0, ambient: 0, sfx: 0 });
    e.cineSting(2);
    e.animal('cat', 'sad');
    const sources = ctxs[0].nodes.slice(before).filter((n) => n.stop.mock.calls.length);
    expect(sources.length).toBeGreaterThan(3);
    e.stopTransient();
    for (const n of sources) expect(n.stop.mock.calls.at(-1)![0]).toBeCloseTo(10.15);
    expect((e.music.gain as any).target).toBeGreaterThan(0);
  });

  it('AUD-16 小喇叭调音只用在手机上：电脑的节点图不变；手机的音量滑块仍然有效', async () => {
    const pc = engine();
    const ph = engine();
    ph.e.detectPhone = () => true;
    for (const x of [pc, ph]) x.e.unlock();
    await flush();
    const any = (e: SoundEngine) => e as any;
    expect(any(pc.e).musicIn).toBe(pc.e.music);
    expect(any(pc.e).ambientIn).toBe(pc.e.ambient);
    expect(any(ph.e).musicIn).not.toBe(ph.e.music);
    expect(ph.ctxs[0].nodes.length - pc.ctxs[0].nodes.length).toBe(5);
    expect((ph.e.music.gain as any).target).toBeCloseTo((pc.e.music.gain as any).target);
  });

  it('AUD-12 节点太多时丢弃不重要的音效，重要的照常', async () => {
    const { e } = engine();
    e.unlock();
    await flush();
    e.activeSources = MAX_ACTIVE_SOURCES;
    e.play('chip');
    expect(e.droppedSfx).toBe(1);
    e.play('win');
    expect(e.droppedSfx).toBe(1);
    expect(e.activeSources).toBeGreaterThan(MAX_ACTIVE_SOURCES);
  });
});

describe('手势与前后台监听', () => {
  function target() {
    const map = new Map<string, Set<any>>();
    return {
      map,
      visibilityState: 'visible',
      addEventListener: (t: string, f: any) => void (map.get(t) ?? map.set(t, new Set()).get(t)!).add(f),
      removeEventListener: (t: string, f: any) => void map.get(t)?.delete(f),
      fire: (t: string, e: any = {}) => map.get(t)?.forEach((f) => f({ type: t, ...e })),
      count: () => [...map.values()].reduce((a, s) => a + s.size, 0),
    };
  }

  it('AUD-13 触摸的 pointerdown 不算激活；pointerup / touchend / click / 鼠标 / 按键才算', () => {
    const ev = (type: string, x: any = {}) => ({ type, ...x }) as any;
    expect(isActivation(ev('pointerdown', { pointerType: 'touch' }))).toBe(false);
    expect(isActivation(ev('pointerdown', { pointerType: 'mouse' }))).toBe(true);
    for (const t of ['pointerup', 'touchend', 'click']) expect(isActivation(ev(t, { pointerType: 'touch' }))).toBe(true);
    expect(isActivation(ev('keydown', { key: 'Enter' }))).toBe(true);
    expect(isActivation(ev('keydown', { key: 'Escape' }))).toBe(false);
  });

  it('AUD-14 重复安装只注册一次，清理后没有残留；电脑版后台不暂停，手机暂停', () => {
    const win = target();
    const doc = target();
    let touch = false;
    const suspend = vi.spyOn(sound, 'suspendForBackground').mockImplementation(() => undefined);
    const resume = vi.spyOn(sound, 'resumeForForeground').mockImplementation(() => undefined);
    const unlock = vi.spyOn(sound, 'unlock').mockImplementation(() => undefined);
    vi.spyOn(sound, 'startMusic').mockImplementation(() => undefined);
    const stop = vi.spyOn(voice, 'stop').mockImplementation(() => undefined);
    const env = { win, doc, isTouch: () => touch } as any;
    const d1 = installAudioLifecycle(env);
    const n = win.count() + doc.count();
    expect(installAudioLifecycle(env)).toBe(d1);
    expect(win.count() + doc.count()).toBe(n);
    expect(n).toBe(ACTIVATION_EVENTS.length + 3);
    win.fire('pointerdown', { pointerType: 'touch' });
    expect(unlock).toHaveBeenCalledTimes(0);
    win.fire('touchend');
    expect(unlock).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(suspend).not.toHaveBeenCalled();
    touch = true;
    doc.fire('visibilitychange');
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    expect(resume).toHaveBeenCalledTimes(1);
    d1();
    expect(win.count() + doc.count()).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('角色语音', () => {
  function env() {
    const spoken: any[] = [];
    const e: VoiceEnv = {
      synth: { speak: (u: any) => void spoken.push(u), cancel: () => undefined, pause: () => undefined, resume: () => undefined, getVoices: () => [{ name: 'Tingting', lang: 'zh-CN', localService: true } as any] },
      Utterance: class { constructor(public text: string) {} } as any,
      canAutoplay: () => true,
    };
    return { v: new BrowserVoiceEngine(e), spoken };
  }

  it('AUD-15 预热只做一次且音量为 0；静音后只显示字幕并停下正在说的话', async () => {
    const { v, spoken } = env();
    v.prime();
    v.prime();
    expect(spoken.map((u) => [u.text, u.volume])).toEqual([['', 0]]);
    const active: boolean[] = [];
    v.onActiveChange = (on) => void active.push(on);
    const p = v.speak('你好。', VOICE_PROFILES.cat, {});
    expect(v.activeVoices).toBe(1);
    v.setMuted(true);
    expect(await p).toBe('interrupted');
    expect(v.activeVoices).toBe(0);
    expect(active).toEqual([true, false]);
    expect(await v.speak('你好。', VOICE_PROFILES.cat, {})).toBe('text-only');
  });
});
