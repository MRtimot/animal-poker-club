// 本地音频引擎：所有音效与背景音乐都由 WebAudio 实时合成，不加载外部资源、不调用任何 API。
//
// 生命周期（整个页面只有一个 AudioContext，由这里负责创建 / 恢复 / 暂停）：
//   uninitialized → locked（等待第一次真正的用户互动）→ initializing → ready
//   ready → suspended（手机切到后台 / 锁屏，由我们暂停）→ resuming → ready
//   任何时候恢复失败（浏览器要求再点一下）→ locked；浏览器不支持 / 被关闭 → error
// 声音永远不会阻塞加载或游戏：没有声音时游戏照常进行，下一次点击再尝试解锁。
// 用户手势的监听在 audioLifecycle.ts（只注册一次）。
import { useSettings } from '../store/settingsStore';
import type { Species } from '../core/player/profile';

type SfxName =
  | 'card' | 'flip' | 'chip' | 'chips' | 'button' | 'hover' | 'win' | 'lose' | 'turn' | 'allin'
  | 'check' | 'fold' | 'shuffle' | 'unlock' | 'pop' | 'tick' | 'royal';

export type AudioStatus = 'uninitialized' | 'locked' | 'initializing' | 'ready' | 'suspended' | 'resuming' | 'error';

/** 恢复（resume）之后多久还没真正开始播放，就认为浏览器需要用户再点一下 */
const RESUME_GRACE_MS = 700;
const MASTER_GAIN = 0.9;
/**
 * 手机 / 平板的调音：小喇叭放不出 300~400 Hz 以下的声音，而爵士贝斯、电钢琴与环境底噪大多在那里，
 * 实测默认音量下音乐在小喇叭频段只有约 -60 dBFS（等于听不到）。这里补中频、抬高音量并限制峰值；电脑版完全不经过。
 */
export const PHONE_TONE = { musicGain: 5, musicPresenceDb: 6, ambientGain: 2.6, ambientCutoff: 1400 };
/** 同时存在的声音节点上限：超过时丢弃不重要的音效（悬停 / 滴答 / 单个筹码），避免手机上卡顿或爆音 */
export const MAX_ACTIVE_SOURCES = 120;
/** 角色说话时背景音乐 / 环境声的倍率（可调整；1 = 不压低） */
export const VOICE_DUCK = { music: 0.45, ambient: 0.6 };
const NO_DUCK = { music: 1, ambient: 1 };
const LOW_PRIORITY_SFX: ReadonlySet<SfxName> = new Set(['hover', 'tick', 'chip', 'pop']);

function defaultCreateContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  return AC ? (new AC() as AudioContext) : null;
}

/** 手机 / 平板（主要输入是触摸） */
export function isTouchPrimary() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** iPhone / iPad（Safari 16.4+）：静音模式下是否仍播放网页声音（系统提供的 Audio Session 接口；其他浏览器没有，直接忽略） */
function applyAudioSession() {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (!session) return;
    const type = useSettings.getState().silentModeSound ? 'playback' : 'auto';
    if (session.type !== type) session.type = type;
  } catch {
    /* 不支持 */
  }
}

function audioSupported() {
  return typeof window !== 'undefined' && !!((window as any).AudioContext || (window as any).webkitAudioContext);
}

export class SoundEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  ambient!: GainNode;
  /** 音符 / 环境声的入口：电脑就是音量节点本身；手机先经过小喇叭调音 */
  private musicIn!: AudioNode;
  private ambientIn!: AudioNode;
  private phone = false;
  /** 是否使用手机调音（测试时替换） */
  detectPhone: () => boolean = isTouchPrimary;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private ambientStarted = false;
  private ambientTimer: ReturnType<typeof setTimeout> | null = null;
  private wantMusic = false;
  /** 当前音效的输出节点（空间音频时指向声像器） */
  private out: AudioNode | null = null;
  private reverbSend!: GainNode;
  /** 电影化演出（失败演出）的专用声音通道：不受牌桌音效压低的影响，音量跟随“音效”设置 */
  cine!: GainNode;
  /** 演出期间的混音倍率（音乐 / 环境声 / 牌桌音效）；1 = 正常。duck() 的恢复也会遵守它，避免演出中途被“恢复”成正常音量 */
  private mixMul = { music: 1, ambient: 1, sfx: 1 };
  /** 音乐紧张度 0~1：正常 → 大底池 → 全押 / 摊牌 */
  private intensity = 0;
  private intensityTarget = 0;
  private intensityUntil = 0;

  // ───────── 生命周期 ─────────
  /** 明确的音频状态（不用一堆互相打架的布尔值） */
  status: AudioStatus = 'uninitialized';
  /** 页面在后台（我们主动暂停了声音） */
  private backgrounded = false;
  /** 已经请求过 suspend()，还没有请求恢复 */
  private suspendRequested = false;
  /** 曾经成功播放过：之后再变成 locked 就提示“点击继续声音” */
  everReady = false;
  /** 本页面创建过几个 AudioContext（应该永远 ≤ 1；调试面板 / 测试检查） */
  contextsCreated = 0;
  /** 当前还在播放的声音节点数（调试面板显示；超过上限时丢弃不重要的音效） */
  activeSources = 0;
  /** 因节点过多而丢弃的音效数 */
  droppedSfx = 0;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  /** 创建 AudioContext 的方式（测试时替换成假的） */
  createContext: () => AudioContext | null = defaultCreateContext;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getStatus = () => this.status;

  private setStatus(s: AudioStatus) {
    if (this.status === s) return;
    this.status = s;
    if (s === 'ready') this.everReady = true;
    for (const fn of [...this.listeners]) fn();
  }

  /** 页面加载后：音频系统就绪，等待用户第一次互动（不创建 AudioContext、不播放任何声音） */
  prepare() {
    if (this.status !== 'uninitialized') return;
    this.setStatus(audioSupported() || this.createContext !== defaultCreateContext ? 'locked' : 'error');
  }

  /** 由 AudioContext 的真实状态推出我们的状态 */
  private syncStatus() {
    const ctx = this.ctx;
    if (!ctx) return;
    const st = ctx.state as string;
    if (st === 'running') {
      this.clearGrace();
      this.setStatus('ready');
    } else if (st === 'closed') {
      this.clearGrace();
      this.setStatus('error');
    } else if (this.backgrounded) {
      this.setStatus('suspended');
    } else if (this.status !== 'initializing' && this.status !== 'resuming') {
      // suspended / interrupted（iOS：来电、Siri、其他 App 占用音频）：需要用户再点一下
      this.setStatus('locked');
    }
  }

  private clearGrace() {
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  /** 请求恢复：Promise 的失败一定被处理；一段时间内没有真正开始播放 → locked（等下一次点击） */
  private requestResume(ctx: AudioContext) {
    let p: Promise<void> | undefined;
    try {
      p = ctx.resume();
    } catch {
      p = undefined;
    }
    p?.then(
      () => this.syncStatus(),
      () => this.syncStatus(),
    );
    this.clearGrace();
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.ctx !== ctx || (ctx.state as string) === 'running' || this.backgrounded) return;
      if ((ctx.state as string) === 'closed') return this.setStatus('error');
      this.setStatus('locked');
    }, RESUME_GRACE_MS);
  }

  /**
   * 在用户手势（点击 / 触摸结束 / 按键）里同步调用：
   * 第一次创建唯一的 AudioContext；之后只在 suspended / interrupted 时 resume()，绝不重复创建。
   */
  unlock() {
    if (this.backgrounded) return;
    if (this.status === 'uninitialized') this.prepare();
    if (this.status === 'error' && !this.ctx) return;
    if (this.ctx) {
      const st = this.ctx.state as string;
      if (st === 'running') return this.syncStatus();
      if (st === 'closed') return this.setStatus('error');
      if (this.status !== 'initializing') this.setStatus('resuming');
      this.primeOutput();
      this.requestResume(this.ctx);
      return;
    }
    let ctx: AudioContext | null = null;
    applyAudioSession();
    try {
      ctx = this.createContext();
    } catch {
      ctx = null;
    }
    if (!ctx) return this.setStatus('error');
    this.ctx = ctx;
    this.contextsCreated++;
    this.setStatus('initializing');
    try {
      this.buildGraph(ctx);
    } catch {
      // 节点图建立失败（极少见）：放弃声音，游戏照常
      this.ctx = null;
      try {
        void ctx.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
      return this.setStatus('error');
    }
    ctx.onstatechange = () => this.syncStatus();
    this.primeOutput();
    if ((ctx.state as string) === 'running') this.syncStatus();
    else this.requestResume(ctx);
    if (this.wantMusic) this.startMusic();
  }

  /** iOS WebKit：在手势里播放一个极短的静音缓冲，确保输出真正被“解锁” */
  private primeOutput() {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start(0);
      src.onended = () => {
        try {
          src.disconnect();
        } catch {
          /* 已断开 */
        }
      };
    } catch {
      /* 不影响后续 */
    }
  }

  /** 手机切到后台 / 锁屏 / 切换 App：暂停整个 AudioContext（音乐、环境声、演出声音一起停，省电） */
  suspendForBackground() {
    this.backgrounded = true;
    this.clearGrace();
    const ctx = this.ctx;
    if (!ctx) return;
    if ((ctx.state as string) === 'running') {
      this.suspendRequested = true;
      try {
        void ctx.suspend().then(
          () => this.syncStatus(),
          () => this.syncStatus(),
        );
      } catch {
        /* ignore */
      }
    }
    if ((ctx.state as string) !== 'closed') this.setStatus('suspended');
  }

  /** 回到前台：尝试恢复（不在手势里，浏览器可能拒绝 → locked，显示“点击继续声音”，下一次点击恢复） */
  resumeForForeground() {
    this.backgrounded = false;
    const ctx = this.ctx;
    if (!ctx) return;
    const st = ctx.state as string;
    if (st === 'closed') return this.setStatus('error');
    // 快速切出又切回：suspend() 可能还没完成（状态仍是 running），这时也必须 resume()，否则随后会悄悄停住
    if (st === 'running' && !this.suspendRequested) return this.syncStatus();
    this.suspendRequested = false;
    this.setStatus('resuming');
    this.requestResume(ctx);
  }

  /** 开发时热更新：关闭旧的 AudioContext 与计时器，避免新旧两套声音同时播放 */
  dispose() {
    this.stopMusic();
    this.clearGrace();
    if (this.ambientTimer !== null) clearTimeout(this.ambientTimer);
    this.ambientTimer = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      ctx.onstatechange = null;
      try {
        void ctx.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
    this.listeners.clear();
  }

  private buildGraph(ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = useSettings.getState().muted ? 0 : MASTER_GAIN;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.ambient = ctx.createGain();
    this.sfx.connect(this.master);
    this.cine = ctx.createGain();
    this.cine.connect(this.master);
    this.music.connect(this.master);
    this.ambient.connect(this.master);
    this.musicIn = this.music;
    this.ambientIn = this.ambient;
    this.phone = this.detectPhone();
    if (this.phone) {
      this.buildPhoneTone(ctx);
      // 音量节点默认是 1：调音放大后，开头渐变到设置音量之前会“冒”一声，所以从 0 淡入
      this.music.gain.value = 0;
      this.ambient.gain.value = 0;
    }
    // 房间混响：用衰减噪声合成的脉冲响应（小型木质房间）
    const conv = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 40 ? i / 40 : 1);
      }
    }
    conv.buffer = ir;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 3800;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.16;
    this.sfx.connect(this.reverbSend);
    this.cine.connect(this.reverbSend);
    this.reverbSend.connect(conv).connect(damp).connect(this.master);
    this.applyVolumes();
    // 噪声缓冲
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** 手机小喇叭调音：切掉放不出的低频 → 补中频 → 限制峰值 → 抬高音量，然后才到音量滑块（滑块 / 压低 / 静音照常线性有效） */
  private buildPhoneTone(ctx: AudioContext) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 900;
    mid.Q.value = 0.7;
    mid.gain.value = PHONE_TONE.musicPresenceDb;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -30;
    comp.ratio.value = 5;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    const g = ctx.createGain();
    g.gain.value = PHONE_TONE.musicGain;
    hp.connect(mid).connect(comp).connect(g).connect(this.music);
    this.musicIn = hp;
    const a = ctx.createGain();
    a.gain.value = PHONE_TONE.ambientGain;
    a.connect(this.ambient);
    this.ambientIn = a;
  }

  /** 牌桌音效与演出声音（不含音乐 / 环境声）：离开牌桌时全部停掉，包括已经排程、还没响的 */
  private transient = new Set<AudioScheduledSourceNode>();

  /** 登记一个声音节点，结束时自动移除 */
  private track(node: AudioScheduledSourceNode, transient: boolean) {
    this.activeSources++;
    if (transient) this.transient.add(node);
    node.onended = () => {
      this.activeSources = Math.max(0, this.activeSources - 1);
      this.transient.delete(node);
    };
  }

  /** 离开牌桌：停止所有临时音效与演出声音（背景音乐继续），混音恢复正常 */
  stopTransient() {
    if (this.duckTimer !== null) clearTimeout(this.duckTimer);
    this.duckTimer = null;
    this.setIntensity(0);
    this.setBaseIntensity(0);
    this.resetMix(0.3);
    const ctx = this.ctx;
    if (!ctx) return;
    // 留 0.15 秒让“离开”按钮自己的点击声响完；演出通道同时淡出，不会“啪”地一声截断
    const t = ctx.currentTime;
    this.cine.gain.setTargetAtTime(0, t, 0.04);
    this.cine.gain.setTargetAtTime(useSettings.getState().sfxVolume, t + 0.3, 0.05);
    for (const n of this.transient) {
      try {
        n.stop(t + 0.15);
      } catch {
        /* 已经结束 */
      }
    }
  }

  /** 音乐 / 环境声的目标音量：设置 × 演出混音 × 角色说话时的压低 × 临时压低（duck） */
  private busTargets(m = this.mixMul, level = 1) {
    const s = useSettings.getState();
    const v = this.voiceDucked ? VOICE_DUCK : NO_DUCK;
    return {
      sfx: s.sfxVolume * m.sfx,
      music: s.musicVolume * 0.5 * m.music * v.music * level,
      ambient: s.ambientVolume * 0.6 * m.ambient * v.ambient * level,
    };
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = useSettings.getState();
    const t = this.ctx.currentTime;
    const g = this.busTargets();
    // 全部静音：只关总音量（各通道的设置保持不变，取消静音后立刻恢复）
    this.master.gain.setTargetAtTime(s.muted ? 0 : MASTER_GAIN, t, 0.03);
    this.sfx.gain.setTargetAtTime(g.sfx, t, 0.05);
    this.cine.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.music.gain.setTargetAtTime(g.music, t, 0.2);
    this.ambient.gain.setTargetAtTime(g.ambient, t, 0.2);
  }

  /** 角色语音（系统语音合成，无法接入 Web Audio）说话期间：压低背景音乐与环境声，说完恢复 */
  private voiceDucked = false;
  setVoiceDuck(on: boolean) {
    if (this.voiceDucked === on) return;
    this.voiceDucked = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.busTargets();
    this.music.gain.setTargetAtTime(g.music, t, on ? 0.12 : 0.5);
    this.ambient.gain.setTargetAtTime(g.ambient, t, on ? 0.12 : 0.5);
  }

  /**
   * 演出混音：把音乐 / 环境声 / 牌桌音效分别压到指定倍率（tc 为过渡时间常数，秒）。
   * 例如紧张阶段 music 0.4（约 -8 dB）、ambient 0.25（约 -12 dB）、sfx 0.18（约 -15 dB）。
   */
  setMix(m: { music: number; ambient: number; sfx: number }, tc = 0.35) {
    this.mixMul = { ...m };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.busTargets();
    this.sfx.gain.setTargetAtTime(g.sfx, t, tc);
    this.music.gain.setTargetAtTime(g.music, t, tc);
    this.ambient.gain.setTargetAtTime(g.ambient, t, tc);
  }

  /** 恢复正常混音（演出结束 / 被打断时一定会调用） */
  resetMix(tc = 0.6) {
    this.setMix({ music: 1, ambient: 1, sfx: 1 }, tc);
    if (this.ctx && this.reverbSend) this.reverbSend.gain.setTargetAtTime(0.16, this.ctx.currentTime, 0.3);
  }

  // ───────── 失败演出的合成声音（全部走 cine 通道） ─────────

  /** 心跳：“咚—咚”，strength 越大越重 */
  cineHeartbeat(strength = 1, delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const v = Math.min(1.4, strength);
    this.tone(64, t, 0.2, { type: 'sine', vol: 0.42 * v, attack: 0.008, glide: 40, dest: this.cine });
    this.noise(t, 0.08, { freq: 140, q: 0.7, type: 'lowpass', vol: 0.22 * v, dest: this.cine });
    this.tone(56, t + 0.17, 0.16, { type: 'sine', vol: 0.3 * v, attack: 0.008, glide: 36, dest: this.cine });
  }

  /** 呼吸：gasp = 倒吸一口气；inhale = 短促地吸气；exhale = 慢慢呼出一口气；shaky = 发抖的呼吸 */
  cineBreath(kind: 'gasp' | 'inhale' | 'exhale' | 'shaky', delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    if (kind === 'gasp') {
      this.noise(t, 0.34, { freq: 1500, q: 1.4, vol: 0.07, attack: 0.09, dest: this.cine });
      this.noise(t + 0.02, 0.28, { freq: 3200, q: 2, vol: 0.025, attack: 0.08, dest: this.cine });
    } else if (kind === 'inhale') {
      this.noise(t, 0.22, { freq: 1900, q: 1.6, vol: 0.05, attack: 0.12, dest: this.cine });
    } else if (kind === 'exhale') {
      this.noise(t, 1.1, { freq: 700, q: 0.9, vol: 0.045, attack: 0.18, dest: this.cine });
      this.noise(t + 0.05, 0.9, { freq: 1600, q: 1.2, vol: 0.015, attack: 0.2, dest: this.cine });
    } else {
      for (let i = 0; i < 3; i++) this.noise(t + i * 0.55, 0.42, { freq: 900 + i * 80, q: 1.1, vol: 0.035, attack: 0.18, dest: this.cine });
    }
  }

  /** 紧张的低频铺底（返回 stop：演出结束 / 被打断时一定会停止） */
  cineDrone(): { stop: (fade?: number) => void } {
    if (!this.ctx || this.ctx.state !== 'running') return { stop: () => undefined };
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const oscs = [49, 49.7, 73.4].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      return o;
    });
    lp.connect(g).connect(this.cine);
    let stopped = false;
    return {
      stop: (fade = 0.12) => {
        if (stopped || !this.ctx) return;
        stopped = true;
        const n = this.ctx.currentTime;
        g.gain.cancelScheduledValues(n);
        g.gain.setTargetAtTime(0.0001, n, fade);
        for (const o of oscs) o.stop(n + fade * 6 + 0.05);
        window.setTimeout(() => {
          try {
            g.disconnect();
            lp.disconnect();
          } catch {
            /* 已断开 */
          }
        }, (fade * 6 + 0.3) * 1000);
      },
    };
  }

  /**
   * 冲击：多层叠加——低频重击 + 瞬态 + 房间里的物体反应 + 牌与筹码 + 房间混响尾音。
   * power：完整版 1，简短版更轻
   */
  cineImpact(power = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const c = this.cine;
    // 1. 低频重击（很长的下滑）
    this.tone(52, t, 1.7, { type: 'sine', vol: 0.95 * power, attack: 0.004, glide: 22, dest: c });
    this.tone(104, t, 0.32, { type: 'triangle', vol: 0.4 * power, attack: 0.002, glide: 38, dest: c });
    // 2. 瞬态（爆裂的“啪”）
    this.noise(t, 0.07, { freq: 2600, q: 0.6, type: 'highpass', vol: 0.55 * power, dest: c });
    this.noise(t, 0.26, { freq: 850, q: 0.8, vol: 0.42 * power, dest: c });
    this.tone(1900, t, 0.05, { type: 'square', vol: 0.05 * power, glide: 320, dest: c });
    // 3. 房间里的物体：玻璃杯、吊灯、木头的零碎反应
    for (let i = 0; i < 9; i++) {
      const d = 0.05 + Math.random() * 0.75;
      this.noise(t + d, 0.04 + Math.random() * 0.06, { freq: 2200 + Math.random() * 4200, q: 6, vol: (0.03 + Math.random() * 0.04) * power, dest: c });
    }
    this.noise(t + 0.03, 0.9, { freq: 320, q: 7, vol: 0.06 * power, dest: c, attack: 0.02 });
    // 4. 牌与筹码落下
    for (let i = 0; i < 6; i++) this.tone(2400 + Math.random() * 1600, t + 0.45 + i * 0.09 + Math.random() * 0.05, 0.05, { type: 'triangle', vol: 0.03 * power, dest: c });
    this.noise(t + 0.6, 0.5, { freq: 4200, q: 1.5, vol: 0.03 * power, attack: 0.05, dest: c });
    // 5. 房间混响尾音：整个房间都听到了，然后很快恢复
    if (this.reverbSend) {
      this.reverbSend.gain.cancelScheduledValues(t);
      this.reverbSend.gain.setValueAtTime(0.16 + 0.5 * power, t);
      this.reverbSend.gain.setTargetAtTime(0.16, t + 0.35, 0.45);
    }
  }

  /**
   * 输家的椅子：被撞得往后滑（摩擦地面），翘起后“咚”地落回地面，再轻轻弹一下。
   * landAt：落地时刻（秒，与画面里椅子落地对齐）；heavy：重的动物，声音更低更重
   */
  cineChair(landAt: number, heavy = false, power = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const c = this.cine;
    this.noise(t + 0.02, 0.24, { freq: heavy ? 420 : 620, q: 3, vol: 0.09 * power, attack: 0.02, dest: c });
    this.tone(heavy ? 92 : 128, t + landAt, 0.16, { type: 'triangle', vol: 0.3 * power, attack: 0.003, glide: heavy ? 60 : 84, dest: c });
    this.noise(t + landAt, 0.06, { freq: 1300, q: 3.5, vol: 0.12 * power, dest: c });
    this.tone(heavy ? 110 : 150, t + landAt + 0.13, 0.08, { type: 'triangle', vol: 0.08 * power, attack: 0.003, glide: 90, dest: c });
  }

  /** “出局”画面出现时的低沉和弦（克制，不是街机式的失败音效） */
  cineSting(delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    [[98, 0.09], [116.5, 0.05], [146.8, 0.05], [196, 0.025]].forEach(([f, v], i) => this.tone(f, t + i * 0.05, 3.2, { type: 'sine', vol: v, attack: 0.4, dest: this.cine }));
  }

  /** 冲击后耳鸣般的高频余音（非常轻，几秒内消失） */
  cineRing(delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    this.tone(3150, t, 2.6, { type: 'sine', vol: 0.012, attack: 0.25, dest: this.cine });
  }

  /**
   * 出局处决的一瞬间（电影式的处决冲击，不是游戏里的“砍刀音”）：
   * 极短的暗色破风声（从高到低扫过）→ 干脆的一下撞击 → 很深的低频重击 → 整个房间的混响 → 回到死寂。
   * hitAt：撞击相对现在的时刻（秒）
   */
  cineExecution(hitAt = 0.09, power = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const c = this.cine;
    // 1. 破风：带通噪声从 5.5 kHz 快速扫到 700 Hz
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.2;
    f.frequency.setValueAtTime(5500, t);
    f.frequency.exponentialRampToValueAtTime(700, t + hitAt + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * power, t + hitAt * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + hitAt + 0.07);
    src.connect(f).connect(g).connect(c);
    src.start(t, Math.random());
    src.stop(t + hitAt + 0.15);
    const h = t + hitAt;
    // 2. 撞击：短促、干脆的瞬态（不带“叮”的金属回响，只有一点几乎听不到的余音）
    this.noise(h, 0.045, { freq: 3200, q: 0.7, type: 'highpass', vol: 0.5 * power, dest: c });
    this.noise(h, 0.16, { freq: 900, q: 0.9, vol: 0.45 * power, dest: c });
    this.tone(2380, h, 0.32, { type: 'sine', vol: 0.014 * power, attack: 0.002, dest: c });
    // 3. 低频重击：很深、很长的下滑
    this.tone(46, h, 1.6, { type: 'sine', vol: 1.0 * power, attack: 0.004, glide: 24, dest: c });
    this.tone(92, h, 0.34, { type: 'triangle', vol: 0.42 * power, attack: 0.003, glide: 40, dest: c });
    this.noise(h + 0.02, 1.1, { freq: 180, q: 0.8, type: 'lowpass', vol: 0.12 * power, attack: 0.04, dest: c });
    // 4. 房间混响：整个房间都听到了，然后慢慢回到死寂
    if (this.reverbSend) {
      this.reverbSend.gain.cancelScheduledValues(h);
      this.reverbSend.gain.setValueAtTime(0.16 + 0.6 * power, h);
      this.reverbSend.gain.setTargetAtTime(0.16, h + 0.5, 0.6);
    }
  }

  /** 头部撞到地面：沉闷、有重量的一声（弹起后的落地更轻）；speed：撞击速度（米 / 秒） */
  cineThud(speed: number, delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const c = this.cine;
    const k = Math.max(0.15, Math.min(1, speed / 6));
    this.tone(96, t, 0.18, { type: 'triangle', vol: 0.5 * k, attack: 0.003, glide: 54, dest: c });
    this.tone(62, t, 0.3, { type: 'sine', vol: 0.45 * k, attack: 0.004, glide: 38, dest: c });
    this.noise(t, 0.09, { freq: 420, q: 0.9, type: 'lowpass', vol: 0.22 * k, dest: c });
    this.noise(t, 0.03, { freq: 1300, q: 3, vol: 0.05 * k, dest: c });
  }

  /** 头部在地上滚动：很轻的低沉摩擦声，逐渐停下 */
  cineRoll(seconds: number, delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    this.noise(t, Math.max(0.2, seconds), { freq: 260, q: 1.4, vol: 0.035, attack: 0.05, dest: this.cine });
  }

  /** 失去头部的身体倒下：沉重地撞在桌上 / 椅子扶手上，桌上的筹码被震得一响 */
  cineBodyFall(heavy: boolean, delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const c = this.cine;
    this.tone(heavy ? 70 : 88, t, 0.34, { type: 'sine', vol: heavy ? 0.6 : 0.42, attack: 0.004, glide: heavy ? 40 : 52, dest: c });
    this.noise(t, 0.14, { freq: 520, q: 0.8, type: 'lowpass', vol: 0.18, dest: c });
    this.noise(t - 0.12, 0.2, { freq: 1500, q: 0.6, vol: 0.03, attack: 0.06, dest: c });
    for (let i = 0; i < 4; i++) this.tone(2200 + Math.random() * 1800, t + 0.04 + i * 0.05 + Math.random() * 0.03, 0.04, { type: 'triangle', vol: 0.02, dest: c });
  }

  /** 余波里还在滚动的筹码：几声很轻的滚动与碰撞，最后一枚倒下 */
  cineChipSettle(delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const c = this.cine;
    this.noise(t, 0.9, { freq: 3800, q: 2.5, vol: 0.012, attack: 0.1, dest: c });
    // 最后一枚筹码在桌上“嗒啦嗒啦”地转着倒下
    for (let i = 0; i < 6; i++) this.tone(3000 + i * 120, t + 0.9 + i * (0.11 - i * 0.012), 0.035, { type: 'triangle', vol: 0.02 * (1 - i * 0.1), dest: c });
  }

  /** 河牌等关键时刻：音乐与环境声短暂降低，然后恢复 */
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  duck(level: number, ms: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.busTargets(this.mixMul, level);
    this.music.gain.setTargetAtTime(g.music, t, 0.15);
    this.ambient.gain.setTargetAtTime(g.ambient, t, 0.15);
    // 连续的压低：只保留最后一个恢复计时，前一个不会提前把音量“恢复”回去
    if (this.duckTimer !== null) clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(() => {
      this.duckTimer = null;
      this.applyVolumes();
    }, ms);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    // 增益默认是 1：声音起点与自动化起点差一个采样时会漏出一声满音量的“咔哒”，手机调音放大后会听见
    if (this.phone) g.gain.value = 0.0001;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(freq: number, t: number, dur: number, opts: { type?: OscillatorType; vol?: number; attack?: number; dest?: AudioNode; glide?: number; detune?: number } = {}) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.glide), t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    this.env(g, t, opts.attack ?? 0.005, opts.vol ?? 0.2, dur);
    o.connect(g).connect(opts.dest ?? this.out ?? this.sfx);
    o.start(t);
    o.stop(t + dur + (opts.attack ?? 0.005) + 0.05);
    this.track(o, opts.dest !== this.musicIn && opts.dest !== this.ambientIn);
  }

  private noise(t: number, dur: number, opts: { freq?: number; q?: number; type?: BiquadFilterType; vol?: number; dest?: AudioNode; attack?: number } = {}) {
    const ctx = this.ctx!;
    if (!this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq ?? 2000;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    this.env(g, t, opts.attack ?? 0.002, opts.vol ?? 0.3, dur);
    src.connect(f).connect(g).connect(opts.dest ?? this.out ?? this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.1);
    this.track(src, opts.dest !== this.musicIn && opts.dest !== this.ambientIn);
  }

  /**
   * 播放音效。pos 为声音在牌桌上的世界坐标：x 决定左右声像，z 决定远近（越远越小声、混响越多），
   * 这样左侧玩家下注时，筹码声就从左边传来。
   */
  play(name: SfxName, delay = 0, pos?: { x: number; z?: number }) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.activeSources >= MAX_ACTIVE_SOURCES && LOW_PRIORITY_SFX.has(name)) {
      this.droppedSfx++;
      return;
    }
    const t = this.ctx.currentTime + delay;
    if (pos && this.ctx.createStereoPanner) {
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.85, Math.min(0.85, pos.x / 4.2));
      const g = this.ctx.createGain();
      const far = Math.max(0, -(pos.z ?? 0)) / 4.2; // 0 = 近处，1 = 桌子对面
      g.gain.value = 1 - far * 0.35;
      pan.connect(g).connect(this.sfx);
      this.out = pan;
      window.setTimeout(() => {
        try {
          pan.disconnect();
          g.disconnect();
        } catch {
          /* 已断开 */
        }
      }, (delay + 3) * 1000);
    }
    try {
      this.playInner(name, t);
    } finally {
      this.out = null;
    }
  }

  /** 音乐紧张度：持续 ms 毫秒后回落到 base */
  setIntensity(level: number, ms = 0) {
    if (ms > 0) {
      this.intensityTarget = Math.max(this.intensityTarget, level);
      this.intensityUntil = performance.now() + ms;
    } else {
      this.intensityTarget = level;
      this.intensityUntil = 0;
    }
  }

  /** 大底池带来的基础紧张度 */
  private baseIntensity = 0;
  setBaseIntensity(level: number) {
    this.baseIntensity = Math.max(0, Math.min(0.6, level));
  }

  private playInner(name: SfxName, t: number) {
    switch (name) {
      case 'card':
        // 纸牌划过空气 + 落在绒布上的闷响
        this.noise(t, 0.09, { freq: 2600, q: 0.7, vol: 0.22, attack: 0.02 });
        this.noise(t + 0.08, 0.05, { freq: 700, q: 0.9, vol: 0.2, type: 'lowpass' });
        break;
      case 'flip':
        this.noise(t, 0.05, { freq: 4200, q: 1.5, vol: 0.3 });
        this.tone(900, t + 0.01, 0.05, { type: 'triangle', vol: 0.05 });
        break;
      case 'shuffle':
        for (let i = 0; i < 9; i++) this.noise(t + i * 0.035, 0.04, { freq: 2600 + Math.random() * 1500, q: 1, vol: 0.18 });
        break;
      case 'chip': {
        const f = 2400 + Math.random() * 900;
        this.tone(f, t, 0.06, { type: 'sine', vol: 0.12 });
        this.tone(f * 1.48, t + 0.004, 0.05, { type: 'sine', vol: 0.07 });
        this.noise(t, 0.03, { freq: 5000, q: 2, vol: 0.12 });
        break;
      }
      case 'chips':
        // 筹码滑过绒布 + 一连串清脆的碰撞声
        this.noise(t, 0.16, { freq: 1100, q: 0.6, vol: 0.06, attack: 0.04, type: 'lowpass' });
        for (let i = 0; i < 7; i++) {
          const tt = t + 0.1 + i * (0.03 + Math.random() * 0.025);
          const f = 2600 + Math.random() * 1600;
          this.tone(f, tt, 0.035, { vol: 0.06 });
          this.tone(f * 1.52, tt + 0.002, 0.025, { vol: 0.03 });
          this.noise(tt, 0.02, { freq: 6000, q: 2.5, vol: 0.07 });
        }
        break;
      case 'check':
        this.noise(t, 0.04, { freq: 600, q: 2, vol: 0.4, type: 'lowpass' });
        this.noise(t + 0.13, 0.04, { freq: 600, q: 2, vol: 0.35, type: 'lowpass' });
        break;
      case 'fold':
        this.noise(t, 0.18, { freq: 1500, q: 0.6, vol: 0.2, attack: 0.03 });
        break;
      case 'button':
        // 触感明确但安静的按键声
        this.noise(t, 0.025, { freq: 1800, q: 1.2, vol: 0.12 });
        this.tone(1100, t, 0.03, { type: 'sine', vol: 0.025 });
        break;
      case 'hover':
        this.tone(1200, t, 0.03, { type: 'sine', vol: 0.03 });
        break;
      case 'pop':
        this.tone(500, t, 0.09, { type: 'sine', vol: 0.18, glide: 1100 });
        break;
      case 'tick':
        this.tone(1800, t, 0.03, { type: 'square', vol: 0.03 });
        break;
      case 'turn':
        this.tone(880, t, 0.18, { type: 'sine', vol: 0.15 });
        this.tone(1320, t + 0.12, 0.28, { type: 'sine', vol: 0.12 });
        break;
      case 'allin': {
        // 低沉的冲击 + 缓慢上升的气流声
        this.tone(55, t, 0.9, { type: 'sine', vol: 0.22, attack: 0.01, glide: 38 });
        this.noise(t, 0.12, { freq: 220, q: 0.7, vol: 0.25, type: 'lowpass' });
        this.noise(t + 0.05, 1.2, { freq: 1600, q: 0.4, vol: 0.05, attack: 0.9 });
        break;
      }
      case 'win': {
        // 温暖的大三和弦缓慢展开，不用卡通琶音
        [261.6, 329.6, 392, 523.3].forEach((f, i) => this.tone(f, t + i * 0.06, 1.6, { type: 'sine', vol: 0.06, attack: 0.08 }));
        this.tone(130.8, t, 1.8, { type: 'triangle', vol: 0.05, attack: 0.1 });
        break;
      }
      case 'lose': {
        [293.7, 261.6].forEach((f, i) => this.tone(f, t + i * 0.32, 0.7, { type: 'sine', vol: 0.06, attack: 0.05, glide: f * 0.98 }));
        break;
      }
      case 'royal': {
        // 皇家同花顺：低沉的铺底 + 缓慢上行的和弦（稀有、隆重但不吵闹）
        this.tone(65.4, t, 2.6, { type: 'sine', vol: 0.12, attack: 0.3 });
        [261.6, 329.6, 392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, t + 0.2 + i * 0.16, 1.8 - i * 0.12, { type: 'sine', vol: 0.07, attack: 0.05 }));
        this.noise(t + 0.2, 1.6, { freq: 9000, q: 0.5, vol: 0.03, attack: 0.6, type: 'highpass' });
        break;
      }
      case 'unlock': {
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, t + i * 0.07, 0.35, { type: 'sine', vol: 0.12 }));
        break;
      }
    }
  }

  /** 合成的动物叫声 */
  animal(species: Species, mood: 'happy' | 'sad' | 'neutral' = 'neutral', delay = 0, bus: 'sfx' | 'cine' = 'sfx') {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const dest = bus === 'cine' ? this.cine : this.sfx;
    const t = this.ctx.currentTime + delay;
    const m = mood === 'happy' ? 1.15 : mood === 'sad' ? 0.85 : 1;
    const voice = (f0: number, f1: number, f2: number, dur: number, type: OscillatorType = 'sawtooth', vol = 0.06) => {
      const ctx = this.ctx!;
      const o = ctx.createOscillator();
      const filt = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0 * m, t);
      o.frequency.exponentialRampToValueAtTime(f1 * m, t + dur * 0.4);
      o.frequency.exponentialRampToValueAtTime(f2 * m, t + dur);
      filt.type = 'bandpass';
      filt.frequency.setValueAtTime(f0 * 3, t);
      filt.frequency.exponentialRampToValueAtTime(f1 * 4, t + dur * 0.5);
      filt.Q.value = 2;
      this.env(g, t, 0.03, vol, dur);
      o.connect(filt).connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.1);
      this.track(o, true);
    };
    switch (species) {
      case 'cat':
        voice(500, 900, 450, 0.45);
        break;
      case 'dog':
        voice(300, 420, 200, 0.14, 'sawtooth', 0.09);
        voice(300, 420, 200, 0.14, 'sawtooth', 0.0001);
        setTimeout(() => this.ctx && voice(320, 440, 210, 0.12, 'sawtooth', 0.08), 170);
        break;
      case 'fox':
        voice(700, 1300, 600, 0.3);
        break;
      case 'frog':
        voice(180, 260, 160, 0.09, 'square', 0.06);
        setTimeout(() => this.ctx && voice(200, 300, 170, 0.12, 'square', 0.06), 130);
        break;
      case 'lion':
      case 'tiger':
        voice(110, 150, 70, 0.7, 'sawtooth', 0.1);
        break;
      case 'wolf':
        voice(400, 700, 520, 1.0, 'triangle', 0.08);
        break;
      case 'penguin':
        voice(600, 800, 500, 0.12, 'square', 0.04);
        setTimeout(() => this.ctx && voice(650, 850, 520, 0.12, 'square', 0.04), 140);
        break;
      case 'rabbit':
      case 'koala':
      case 'panda':
        voice(800, 1100, 900, 0.16, 'triangle', 0.06);
        break;
      case 'monkey':
        for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && voice(700, 1200, 800, 0.1, 'triangle', 0.06), i * 110);
        break;
      case 'dragon':
        voice(90, 140, 60, 0.9, 'sawtooth', 0.1);
        this.noise(t, 0.8, { freq: 600, q: 0.5, vol: 0.1, attack: 0.1, dest });
        break;
      default:
        voice(250, 330, 200, 0.35, 'sawtooth', 0.07);
    }
  }

  // ───────────── 背景音乐：生成式慵懒爵士 ─────────────

  startMusic() {
    this.wantMusic = true;
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicStep = 0;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 100);
    this.startAmbient();
  }

  stopMusic() {
    this.wantMusic = false;
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private scheduleMusic() {
    const ctx = this.ctx!;
    const bpm = 84 + this.intensity * 10;
    const eighth = 60 / bpm / 2;
    // ii–V–I–vi 进行（F 大调）
    const chords: [number, number[]][] = [
      [98.0, [0, 3, 7, 10]], // Gm7
      [130.81, [0, 4, 7, 10]], // C7
      [87.31, [0, 4, 7, 11]], // Fmaj7
      [146.83, [0, 3, 7, 10]], // Dm7
    ];
    // 紧张度平滑变化
    if (this.intensityUntil && performance.now() > this.intensityUntil) {
      this.intensityTarget = 0;
      this.intensityUntil = 0;
    }
    this.intensity += (Math.max(this.baseIntensity, this.intensityTarget) - this.intensity) * 0.08;
    // 计时器被浏览器延后（标签页在后台、系统休眠后恢复）：跳过已经错过的音符，
    // 不能把错过的几秒、几分钟的音符一次性补上（会瞬间同时响起一大串声音，也会创建大量声音节点）
    if (this.nextNoteTime < ctx.currentTime - 0.05) this.nextNoteTime = ctx.currentTime + 0.05;
    const st = useSettings.getState();
    const silent = st.muted || st.musicVolume <= 0.001 || this.mixMul.music <= 0.001;
    while (this.nextNoteTime < ctx.currentTime + 0.4) {
      const t = this.nextNoteTime;
      const step = this.musicStep;
      const bar = Math.floor(step / 8) % 4;
      const beat = step % 8;
      const [root, intervals] = chords[bar];
      const r = root;
      // 音乐被关掉 / 全部静音 / 演出把音乐压到 0：只推进节拍，不创建任何声音节点（手机上省 CPU）
      if (!silent) {
        // 电钢琴和弦（第 1、4.5 拍）
        if (beat === 0 || beat === 5) {
          intervals.forEach((iv, i) => {
            const f = r * 2 * 2 ** (iv / 12);
            this.tone(f, t + i * 0.012, beat === 0 ? 1.4 : 0.6, { type: 'sine', vol: 0.035, attack: 0.02, dest: this.musicIn });
            this.tone(f * 2, t + i * 0.012, 0.4, { type: 'triangle', vol: 0.008, attack: 0.01, dest: this.musicIn });
          });
        }
        // 行走贝斯
        if (beat % 2 === 0) {
          const walk = [0, 7, 12, 10][beat / 2];
          const bass = r * 2 ** (walk / 12) * (r > 120 ? 0.5 : 1);
          this.tone(bass, t, eighth * 1.8, { type: 'triangle', vol: 0.09, attack: 0.01, dest: this.musicIn });
          // 小喇叭放不出贝斯的基音：补上高两个八度的泛音，听感上仍是同一条贝斯线
          if (this.phone) this.tone(bass * 4, t, eighth * 1.3, { type: 'triangle', vol: 0.03, attack: 0.01, dest: this.musicIn });
        }
        // 刷子鼓
        this.noise(t, beat % 2 ? 0.05 : 0.09, { freq: 7000, q: 0.7, vol: (beat % 2 ? 0.015 : 0.03) * (1 + this.intensity * 0.8), type: 'highpass', dest: this.musicIn });
        // 紧张度：低频脉冲（心跳感）与持续的低音铺底
        if (this.intensity > 0.3 && beat % 4 === 0) {
          this.tone(55, t, 0.22, { type: 'sine', vol: 0.11 * this.intensity, attack: 0.005, glide: 40, dest: this.musicIn });
        }
        if (this.intensity > 0.6 && beat === 0) {
          this.tone(r * 0.5, t, eighth * 8, { type: 'sawtooth', vol: 0.012 * this.intensity, attack: 0.4, dest: this.musicIn });
        }
        // 偶尔的旋律
        if (beat === 3 && Math.random() < 0.5) {
          const scale = [0, 2, 4, 7, 9, 12];
          const f = 349.2 * 2 ** (scale[Math.floor(Math.random() * scale.length)] / 12);
          this.tone(f, t, 0.5, { type: 'sine', vol: 0.03, attack: 0.02, dest: this.musicIn });
        }
      }
      const swing = beat % 2 === 0 ? eighth * 1.18 : eighth * 0.82;
      this.nextNoteTime += swing;
      this.musicStep++;
    }
  }

  /** 环境声：森林夜晚的虫鸣 + 低沉的室内底噪（整个页面只启动一次） */
  private startAmbient() {
    if (!this.ctx || this.ambientStarted || !this.noiseBuf) return;
    this.ambientStarted = true;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.phone ? PHONE_TONE.ambientCutoff : 320;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(this.ambientIn);
    src.start();
    const chirp = () => {
      this.ambientTimer = null;
      if (!this.ctx) return;
      const s = useSettings.getState();
      // 声音暂停中（后台 / 等待点击）或环境声被关掉：不创建节点——否则暂停期间排队的声音会在恢复时一起响
      if ((this.ctx.state as string) === 'running' && !s.muted && s.ambientVolume > 0.001 && this.mixMul.ambient > 0.001) {
        const t = this.ctx.currentTime;
        if (s.room === 'cabin') {
          // 森林小屋：窗外的虫鸣
          const base = 3800 + Math.random() * 1200;
          for (let i = 0; i < 3; i++) this.tone(base, t + i * 0.07, 0.04, { type: 'sine', vol: 0.012, dest: this.ambientIn });
        } else if (Math.random() < 0.35) {
          // 赌场 / 高层：远处偶尔传来的杯子轻碰声
          const fr = 2400 + Math.random() * 900;
          this.tone(fr, t, 0.5, { type: 'sine', vol: 0.006, dest: this.ambientIn });
          this.tone(fr * 2.7, t, 0.3, { type: 'sine', vol: 0.003, dest: this.ambientIn });
        }
      }
      this.ambientTimer = setTimeout(chirp, 2500 + Math.random() * 5000);
    };
    this.ambientTimer = setTimeout(chirp, 3000);
  }

  /** 调试面板：当前音频状态 */
  debugInfo() {
    const s = useSettings.getState();
    return {
      status: this.status,
      context: (this.ctx?.state as string | undefined) ?? 'none',
      contexts: this.contextsCreated,
      bgm: this.musicTimer !== null && !!this.ctx && (this.ctx.state as string) === 'running' && !s.muted && s.musicVolume > 0,
      activeSources: this.activeSources,
      dropped: this.droppedSfx,
    };
  }
}

export const sound = new SoundEngine();

// 设置改变（音量 / 静音）立即生效，不需要重新进入牌局
useSettings.subscribe((s, prev) => {
  sound.applyVolumes();
  if (s.silentModeSound !== prev.silentModeSound) applyAudioSession();
});

// 开发时热更新：旧引擎的声音与计时器全部停掉
if (import.meta.hot) import.meta.hot.dispose(() => sound.dispose());
