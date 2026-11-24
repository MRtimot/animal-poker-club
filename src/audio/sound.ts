// 本地音频引擎：所有音效与背景音乐都由 WebAudio 实时合成，不加载外部资源、不调用任何 API。
import { useSettings } from '../store/settingsStore';
import type { Species } from '../core/player/profile';

type SfxName =
  | 'card' | 'flip' | 'chip' | 'chips' | 'button' | 'hover' | 'win' | 'lose' | 'turn' | 'allin'
  | 'check' | 'fold' | 'shuffle' | 'unlock' | 'pop' | 'tick' | 'royal';

class SoundEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  ambient!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private ambientStarted = false;
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

  /** 首次用户交互后初始化（浏览器策略要求） */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC() as AudioContext;
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
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
    if (this.wantMusic) this.startMusic();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = useSettings.getState();
    const t = this.ctx.currentTime;
    const m = this.mixMul;
    this.sfx.gain.setTargetAtTime(s.sfxVolume * m.sfx, t, 0.05);
    this.cine.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.music.gain.setTargetAtTime(s.musicVolume * 0.5 * m.music, t, 0.2);
    this.ambient.gain.setTargetAtTime(s.ambientVolume * 0.6 * m.ambient, t, 0.2);
  }

  /**
   * 演出混音：把音乐 / 环境声 / 牌桌音效分别压到指定倍率（tc 为过渡时间常数，秒）。
   * 例如紧张阶段 music 0.4（约 -8 dB）、ambient 0.25（约 -12 dB）、sfx 0.18（约 -15 dB）。
   */
  setMix(m: { music: number; ambient: number; sfx: number }, tc = 0.35) {
    this.mixMul = { ...m };
    if (!this.ctx) return;
    const s = useSettings.getState();
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(s.sfxVolume * m.sfx, t, tc);
    this.music.gain.setTargetAtTime(s.musicVolume * 0.5 * m.music, t, tc);
    this.ambient.gain.setTargetAtTime(s.ambientVolume * 0.6 * m.ambient, t, tc);
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

  /** 河牌等关键时刻：音乐与环境声短暂降低，然后恢复 */
  duck(level: number, ms: number) {
    if (!this.ctx) return;
    const s = useSettings.getState();
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(s.musicVolume * 0.5 * level * this.mixMul.music, t, 0.15);
    this.ambient.gain.setTargetAtTime(s.ambientVolume * 0.6 * level * this.mixMul.ambient, t, 0.15);
    window.setTimeout(() => this.applyVolumes(), ms);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
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
  }

  /**
   * 播放音效。pos 为声音在牌桌上的世界坐标：x 决定左右声像，z 决定远近（越远越小声、混响越多），
   * 这样左侧玩家下注时，筹码声就从左边传来。
   */
  play(name: SfxName, delay = 0, pos?: { x: number; z?: number }) {
    if (!this.ctx || this.ctx.state !== 'running') return;
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
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100);
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
    while (this.nextNoteTime < ctx.currentTime + 0.4) {
      const t = this.nextNoteTime;
      const step = this.musicStep;
      const bar = Math.floor(step / 8) % 4;
      const beat = step % 8;
      const [root, intervals] = chords[bar];
      const r = root;
      // 电钢琴和弦（第 1、4.5 拍）
      if (beat === 0 || beat === 5) {
        intervals.forEach((iv, i) => {
          const f = r * 2 * 2 ** (iv / 12);
          this.tone(f, t + i * 0.012, beat === 0 ? 1.4 : 0.6, { type: 'sine', vol: 0.035, attack: 0.02, dest: this.music });
          this.tone(f * 2, t + i * 0.012, 0.4, { type: 'triangle', vol: 0.008, attack: 0.01, dest: this.music });
        });
      }
      // 行走贝斯
      if (beat % 2 === 0) {
        const walk = [0, 7, 12, 10][beat / 2];
        this.tone(r * 2 ** (walk / 12) * (r > 120 ? 0.5 : 1), t, eighth * 1.8, { type: 'triangle', vol: 0.09, attack: 0.01, dest: this.music });
      }
      // 刷子鼓
      this.noise(t, beat % 2 ? 0.05 : 0.09, { freq: 7000, q: 0.7, vol: (beat % 2 ? 0.015 : 0.03) * (1 + this.intensity * 0.8), type: 'highpass', dest: this.music });
      // 紧张度：低频脉冲（心跳感）与持续的低音铺底
      if (this.intensity > 0.3 && beat % 4 === 0) {
        this.tone(55, t, 0.22, { type: 'sine', vol: 0.11 * this.intensity, attack: 0.005, glide: 40, dest: this.music });
      }
      if (this.intensity > 0.6 && beat === 0) {
        this.tone(r * 0.5, t, eighth * 8, { type: 'sawtooth', vol: 0.012 * this.intensity, attack: 0.4, dest: this.music });
      }
      // 偶尔的旋律
      if (beat === 3 && Math.random() < 0.5) {
        const scale = [0, 2, 4, 7, 9, 12];
        const f = 349.2 * 2 ** (scale[Math.floor(Math.random() * scale.length)] / 12);
        this.tone(f, t, 0.5, { type: 'sine', vol: 0.03, attack: 0.02, dest: this.music });
      }
      const swing = beat % 2 === 0 ? eighth * 1.18 : eighth * 0.82;
      this.nextNoteTime += swing;
      this.musicStep++;
    }
  }

  /** 环境声：森林夜晚的虫鸣 + 低沉的室内底噪 */
  private startAmbient() {
    if (!this.ctx || this.ambientStarted || !this.noiseBuf) return;
    this.ambientStarted = true;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(this.ambient);
    src.start();
    const chirp = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const room = useSettings.getState().room;
      if (room === 'cabin') {
        // 森林小屋：窗外的虫鸣
        const base = 3800 + Math.random() * 1200;
        for (let i = 0; i < 3; i++) this.tone(base, t + i * 0.07, 0.04, { type: 'sine', vol: 0.012, dest: this.ambient });
      } else if (Math.random() < 0.35) {
        // 赌场 / 高层：远处偶尔传来的杯子轻碰声
        const f = 2400 + Math.random() * 900;
        this.tone(f, t, 0.5, { type: 'sine', vol: 0.006, dest: this.ambient });
        this.tone(f * 2.7, t, 0.3, { type: 'sine', vol: 0.003, dest: this.ambient });
      }
      setTimeout(chirp, 2500 + Math.random() * 5000);
    };
    setTimeout(chirp, 3000);
  }
}

export const sound = new SoundEngine();

if (typeof window !== 'undefined') {
  const unlock = () => {
    sound.unlock();
    sound.startMusic();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  useSettings.subscribe(() => sound.applyVolumes());
}
