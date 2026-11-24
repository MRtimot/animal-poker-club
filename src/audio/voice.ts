// 角色语音引擎：使用浏览器自带的语音合成（SpeechSynthesis），完全免费、无需任何 API Key。
//
// 架构：性格 → 台词意图 → 情绪 → 说话风格 → 语调规划（prosody.ts）→ 语音引擎（这里）→ 角色动画
// 所有引擎都实现 CharacterVoiceEngine，以后接入更高质量的神经网络语音时只需替换引擎，台词 / 角色 / 动画都不用改。
//
// 真实的限制（不假装）：
// - 音色本身来自设备自带的“系统语音”，不是真人级 AI 语音；不同设备听起来会不一样
// - 我们能控制的是：分段、停顿、每段的音高 / 语速 / 音量、情绪与角色差异；一段之内无法逐字调节
// - 浏览器语音合成的声音无法接入 Web Audio，所以不能做 EQ / 压缩 / 混响等后期处理，也不伪造呼吸声
// - 拿不到音频波形，口型由“每段开始 / 结束 / 词边界”事件驱动
// - 浏览器要求用户先与页面互动（点击 / 按键）之后才允许发声；在那之前只显示字幕
import type { AnimalEmotion, AnimalVoiceProfile } from '../core/character/voice';
import { emotionModifier } from '../core/character/voice';
import { planSpeech, estimateSegmentMs, type SpeechPlan, type SpeechSegment } from '../core/character/prosody';

export type VoiceStatus = 'ok' | 'unsupported' | 'no-chinese-voice' | 'loading';
export type VoiceResult = 'spoken' | 'text-only' | 'interrupted' | 'skipped';

export interface SpeakOptions {
  emotion?: AnimalEmotion;
  /** 0 闲聊 ~ 3 重大事件；高优先级会打断低优先级 */
  priority?: number;
  /** 玩家设置：语音音量 0~1、语速倍率 */
  volume?: number;
  rate?: number;
  /** 预先规划好的语调（不传则按角色与情绪自动规划） */
  plan?: SpeechPlan;
  /** false：整句一次读完、参数固定（用于“平直 vs 自然”对比） */
  natural?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onBoundary?: (charIndex: number) => void;
  /** 每一小段开始发声 */
  onSegment?: (index: number, seg: SpeechSegment) => void;
  /** 一小段说完、进入停顿（毫秒） */
  onPause?: (index: number, ms: number) => void;
}

/** 语音音质（诚实标注给玩家看） */
export type VoiceQuality = 'system' | 'neural' | 'none';

/**
 * 角色语音引擎接口。当前实现：BrowserVoiceEngine（设备系统语音）。
 * 以后接入高质量神经网络语音（本地模型或服务）时，实现这个接口即可。
 */
export interface CharacterVoiceEngine {
  readonly quality: VoiceQuality;
  status(): VoiceStatus;
  speak(text: string, profile: AnimalVoiceProfile, opts?: SpeakOptions): Promise<VoiceResult>;
  stop(): void;
  pause(): void;
  resume(): void;
  readonly speaking: boolean;
}

/** 可注入的环境（测试时使用假的语音合成） */
export interface VoiceEnv {
  synth: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'pause' | 'resume' | 'getVoices'> & {
    addEventListener?: (type: 'voiceschanged', fn: () => void) => void;
    removeEventListener?: (type: 'voiceschanged', fn: () => void) => void;
  };
  Utterance: new (text: string) => SpeechSynthesisUtterance;
  /** 用户是否已经与页面互动过（浏览器自动播放限制） */
  canAutoplay: () => boolean;
}

interface Resolved {
  voice: SpeechSynthesisVoice | null;
  pitch: number;
  rate: number;
  volume: number;
}

interface Job {
  text: string;
  profile: AnimalVoiceProfile;
  opts: SpeakOptions;
  plan: SpeechPlan;
  priority: number;
  resolve: (r: VoiceResult) => void;
}

// 常见系统中文语音的名字（用来大致区分男声 / 女声；各平台不同，只是“偏好”）
const FEMALE = ['tingting', 'ting-ting', 'meijia', 'mei-jia', 'sinji', 'huihui', 'yaoyao', 'xiaoxiao', 'xiaoyi', 'hanhan', 'yating', 'flo', 'sandy', 'shelley', 'grandma', 'female', '女'];
const MALE = ['kangkang', 'yunxi', 'yunyang', 'yunjian', 'li-mu', 'limu', 'eddy', 'reed', 'rocko', 'grandpa', 'male', '男'];

const isChinese = (v: SpeechSynthesisVoice) => /^(zh|cmn|yue)([-_]|$)/i.test(v.lang);
const isMainland = (v: SpeechSynthesisVoice) => /^(zh[-_]CN|cmn[-_]Hans|zh[-_]Hans)/i.test(v.lang) || v.lang.toLowerCase() === 'zh';
const has = (v: SpeechSynthesisVoice, names: string[]) => names.some((n) => v.name.toLowerCase().includes(n));

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 估算一句中文的朗读时间（毫秒），用于没有真实语音时的口型动画与字幕时长 */
export function estimateSpeechMs(text: string, rate = 1) {
  const chars = [...text].filter((c) => !/[\s，。！？、…,.!?~～“”"'‘’—-]/.test(c)).length;
  const pauses = (text.match(/[，。！？、…,.!?]/g) ?? []).length;
  return Math.round((chars / (5.2 * rate)) * 1000 + pauses * 180 + 300);
}

export class BrowserVoiceEngine implements CharacterVoiceEngine {
  readonly quality: VoiceQuality;
  private voices: SpeechSynthesisVoice[] = [];
  private cache = new Map<string, Resolved>();
  private queue: Job[] = [];
  private current: Job | null = null;
  private currentTimer: ReturnType<typeof setTimeout> | null = null;
  /** 每播放一段 +1：旧语音迟到的回调（被取消后才触发的 onerror 等）会被忽略 */
  private token = 0;
  /**
   * 实测：每句语音结束前引擎自带的静音（毫秒）。不同设备差别很大（macOS 约 300~600ms），
   * 分段播放时要从计划的停顿里扣掉，否则停顿会比计划长很多、结巴会变成“停顿”。
   */
  private tailMs = 0;
  private tailSamples = 0;
  /** 有角色开始 / 停止说话（用来压低背景音乐） */
  onActiveChange: ((speaking: boolean) => void) | null = null;
  private lastActive = false;
  private emitActive() {
    const on = !!this.current;
    if (on === this.lastActive) return;
    this.lastActive = on;
    this.onActiveChange?.(on);
  }
  /** 全部静音：只显示字幕 */
  private muted = false;
  private primed = false;
  private onVoices = () => {
    this.voices = this.env?.synth.getVoices() ?? [];
    this.cache.clear();
  };

  constructor(private env: VoiceEnv | null) {
    this.quality = env ? 'system' : 'none';
    if (env) {
      this.onVoices();
      env.synth.addEventListener?.('voiceschanged', this.onVoices);
    }
  }

  /** 设备是否支持角色语音 */
  status(): VoiceStatus {
    if (!this.env) return 'unsupported';
    if (!this.voices.length) this.onVoices();
    if (!this.voices.length) return 'loading';
    return this.voices.some(isChinese) ? 'ok' : 'no-chinese-voice';
  }

  chineseVoices() {
    return this.voices.filter(isChinese);
  }

  /**
   * 为角色挑选系统语音。回退顺序：
   * 这只动物偏好的语音 → 同性别的普通话语音 → 任意普通话语音 → 任意中文语音 → 无（只显示字幕）
   */
  pickVoice(profile: AnimalVoiceProfile): SpeechSynthesisVoice | null {
    const zh = this.chineseVoices();
    if (!zh.length) return null;
    const mainland = zh.filter(isMainland);
    const pool = mainland.length ? mainland : zh;
    // 1. 这只动物偏好的系统语音（普通话优先）
    for (const hint of profile.voiceHints ?? []) {
      const hit = pool.find((v) => v.name.toLowerCase().includes(hint)) ?? zh.find((v) => v.name.toLowerCase().includes(hint));
      if (hit) return hit;
    }
    const byGender = profile.gender === 'female' ? pool.filter((v) => has(v, FEMALE)) : profile.gender === 'male' ? pool.filter((v) => has(v, MALE)) : [];
    // 同一类型有多个语音时，不同动物分到不同的语音（增加差异）
    const choose = (list: SpeechSynthesisVoice[]) => list[hash(profile.voiceId) % list.length];
    if (byGender.length) return choose(byGender);
    const local = pool.filter((v) => v.localService);
    return choose(local.length ? local : pool);
  }

  /** 角色 + 情绪 → 最终的声音参数（缓存，不会每句话都重新计算） */
  resolve(profile: AnimalVoiceProfile, emotion: AnimalEmotion = 'neutral'): Resolved {
    const key = `${profile.voiceId}|${profile.pitch}|${profile.speed}|${profile.gender}|${emotion}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const mod = emotionModifier(emotion, profile.natural?.emotionIntensity);
    const r: Resolved = {
      voice: this.pickVoice(profile),
      pitch: Math.max(0.1, Math.min(2, profile.pitch * mod.pitchMultiplier)),
      rate: Math.max(0.5, Math.min(2, profile.speed * mod.rateMultiplier)),
      volume: Math.max(0, Math.min(1, profile.volume * mod.volumeMultiplier)),
    };
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, r);
    return r;
  }

  /**
   * 说一句话。返回：spoken（已播放）/ text-only（设备不支持或被浏览器限制，只显示字幕）/
   * interrupted（被更重要的台词打断）/ skipped（队列已满，被丢弃）
   */
  speak(text: string, profile: AnimalVoiceProfile, opts: SpeakOptions = {}): Promise<VoiceResult> {
    if (!this.env || this.muted || this.status() !== 'ok' || !this.env.canAutoplay()) return Promise.resolve('text-only');
    const priority = opts.priority ?? 1;
    return new Promise<VoiceResult>((resolve) => {
      const plan = opts.plan ?? planSpeech(text, profile, opts.emotion ?? 'neutral', Math.random, { natural: opts.natural });
      const job: Job = { text, profile, opts, plan, priority, resolve };
      if (this.current && priority > this.current.priority) {
        // 更重要的台词：打断正在说的话，并丢掉排队中不重要的
        for (const q of this.queue.filter((x) => x.priority < priority)) q.resolve('skipped');
        this.queue = this.queue.filter((x) => x.priority >= priority);
        this.finish('interrupted');
        this.env!.synth.cancel();
      }
      if (this.current) {
        // 最多排 2 句，避免说个不停
        if (this.queue.length >= 2) {
          const lowest = this.queue.reduce((a, b) => (b.priority < a.priority ? b : a));
          if (lowest.priority >= priority) return resolve('skipped');
          this.queue = this.queue.filter((x) => x !== lowest);
          lowest.resolve('skipped');
        }
        this.queue.push(job);
        return;
      }
      this.play(job);
    });
  }

  /** 分段播放：开口前停顿 → 第 1 段 → 停顿 → 第 2 段 …（每段参数不同） */
  private play(job: Job) {
    this.playJob(job);
    this.emitActive();
  }

  private playJob(job: Job) {
    const env = this.env!;
    this.current = job;
    const r = this.resolve(job.profile, job.opts.emotion);
    if (!r.voice || !job.plan.segments.length) {
      // 这一句无法朗读（只显示字幕）：继续播放排在后面的台词，否则它们会一直卡在队列里
      this.current = null;
      job.resolve('text-only');
      const next = this.queue.shift();
      if (next) this.play(next);
      return;
    }
    const v = r.voice;
    // 引擎自带的句尾静音很长时，“等、等一下”分开读会变成停顿：合回一句，让引擎自己读出顿挫
    const segments = this.tailMs > 220 ? mergeStutters(job.plan.segments) : job.plan.segments;
    let started = false;
    let i = 0;
    const next = () => {
      if (this.current !== job) return;
      if (i >= segments.length) return this.done(job, 'spoken');
      const idx = i++;
      const seg = segments[idx];
      let segStart = 0;
      const my = ++this.token;
      const live = () => this.current === job && this.token === my;
      const u = new env.Utterance(seg.text);
      u.voice = v;
      u.lang = v.lang;
      u.pitch = seg.pitch;
      u.rate = Math.max(0.5, Math.min(2, seg.rate * (job.opts.rate ?? 1)));
      u.volume = Math.max(0, Math.min(1, seg.volume * (job.opts.volume ?? 1)));
      const afterSeg = () => {
        if (!live()) return;
        this.clearTimer();
        if (segStart) this.learnTail(performance.now() - segStart - estimateSegmentMs(seg.text, u.rate));
        // 扣掉引擎自带的句尾静音，但至少保留 40% 的计划停顿（停顿不会消失）
        const planned = seg.pauseAfterMs;
        const pause = planned > 0 ? Math.round(Math.max(planned * 0.4, planned - this.tailMs)) : 0;
        if (idx < segments.length - 1 && pause > 0) {
          job.opts.onPause?.(idx, pause);
          this.currentTimer = setTimeout(next, pause);
        } else next();
      };
      u.onstart = () => {
        if (!live()) return;
        segStart = performance.now();
        if (!started) {
          started = true;
          job.opts.onStart?.();
        }
        job.opts.onSegment?.(idx, seg);
      };
      u.onboundary = (e: SpeechSynthesisEvent) => live() && job.opts.onBoundary?.(e.charIndex);
      u.onend = afterSeg;
      u.onerror = (e: SpeechSynthesisErrorEvent) => {
        if (!live()) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return this.done(job, 'interrupted');
        // 某一段出错：跳过这一段继续说；第一段就失败则只显示字幕
        if (!started && idx === 0) return this.done(job, 'text-only');
        afterSeg();
      };
      // 有些浏览器偶尔不触发 onend：超时后强制进入下一段，避免队列卡住
      this.clearTimer();
      this.currentTimer = setTimeout(() => {
        if (!live()) return;
        this.token++; // 让被取消的这一段迟到的回调失效
        env.synth.cancel();
        if (i >= segments.length) this.done(job, started ? 'spoken' : 'text-only');
        else next();
      }, estimateSegmentMs(seg.text, u.rate) * 2 + 2500);
      env.synth.speak(u);
    };
    if (job.plan.leadInMs > 0) this.currentTimer = setTimeout(next, job.plan.leadInMs);
    else next();
  }

  /** 记录一段语音比预计多出来的时间（主要是引擎的句尾静音），取平滑后的值 */
  private learnTail(extraMs: number) {
    const x = Math.max(0, Math.min(600, extraMs));
    this.tailSamples++;
    this.tailMs = this.tailSamples === 1 ? x : Math.round(this.tailMs * 0.75 + x * 0.25);
  }

  /** 当前设备每句语音的句尾静音估计（调试面板显示） */
  get measuredTailMs() {
    return this.tailMs;
  }

  private clearTimer() {
    if (this.currentTimer) clearTimeout(this.currentTimer);
    this.currentTimer = null;
  }

  private done(job: Job, result: VoiceResult) {
    if (this.current !== job) return;
    this.finish(result);
    const next = this.queue.shift();
    if (next) this.play(next);
    else this.emitActive();
  }

  private finish(result: VoiceResult) {
    const job = this.current;
    if (!job) return;
    this.clearTimer();
    this.token++;
    this.current = null;
    job.opts.onEnd?.();
    job.resolve(result);
  }

  /** 停止所有角色语音（离开牌桌、关闭语音时调用） */
  stop() {
    for (const q of this.queue) q.resolve('skipped');
    this.queue = [];
    this.finish('interrupted');
    this.env?.synth.cancel();
    this.emitActive();
  }

  /** 全部静音：立刻停下正在说的话，之后的台词只显示字幕 */
  setMuted(m: boolean) {
    if (this.muted === m) return;
    this.muted = m;
    if (m) this.stop();
  }

  /**
   * iOS Safari：语音合成必须先在一次用户手势里“说”过一句，之后（不在手势里）的台词才能发声。
   * 在第一次点击时说一句音量为 0 的空台词；只做一次，正在说话时不做。
   */
  prime() {
    if (this.primed || !this.env || this.current) return;
    this.primed = true;
    try {
      const u = new this.env.Utterance('');
      u.volume = 0;
      this.env.synth.speak(u);
    } catch {
      /* 不支持就只显示字幕 */
    }
  }

  /** 调试面板：正在说话 + 排队中的台词数 */
  get activeVoices() {
    return (this.current ? 1 : 0) + this.queue.length;
  }

  pause() {
    this.env?.synth.pause();
  }

  resume() {
    this.env?.synth.resume();
  }

  get speaking() {
    return !!this.current;
  }

  dispose() {
    this.stop();
    this.env?.synth.removeEventListener?.('voiceschanged', this.onVoices);
  }
}

/** 把结巴段（“等、”）合并进下一段：“等、等一下！” */
export function mergeStutters(segs: SpeechSegment[]): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  let carry = '';
  for (const s of segs) {
    if (s.kind === 'stutter') {
      carry += s.text + '、';
      continue;
    }
    out.push(carry ? { ...s, text: carry + s.text } : s);
    carry = '';
  }
  if (carry) out.push({ ...segs[segs.length - 1], text: carry.replace(/、$/, '') });
  return out;
}

function browserEnv(): VoiceEnv | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return null;
  let interacted = false;
  const mark = () => (interacted = true);
  // 触摸设备上 pointerdown 不算“用户激活”，真正生效的是 touchend / click
  for (const t of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(t, mark, { once: true, capture: true, passive: true });
  return {
    synth: window.speechSynthesis,
    Utterance: window.SpeechSynthesisUtterance,
    canAutoplay: () => interacted || !!(navigator as any).userActivation?.hasBeenActive,
  };
}

/** 兼容旧名字 */
export { BrowserVoiceEngine as VoiceManager };

/** 当前使用的角色语音引擎（不支持的设备上所有调用都会安全地返回“只显示字幕”） */
export const voice = new BrowserVoiceEngine(browserEnv());
