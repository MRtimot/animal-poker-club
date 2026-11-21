// 语调规划（Prosody）：把一句台词拆成“说话的小段”，每段有自己的音高 / 语速 / 音量和段后停顿。
//
// 为什么要这样做：浏览器语音合成一次只能用一组固定参数读完整句话，听起来就是“念稿”。
// 我们在 “……” “——” 结巴的 “、” 以及句与句之间切开，分段播放，让每段的参数自然变化：
//   - 问句：最后一段音高抬高（配合“？”本身的升调）
//   - 自信的短句（“我跟。”）：更慢、更重、句尾下沉
//   - 犹豫（“嗯……”）：更轻、更慢，后面停得更久
//   - 每次播放都有轻微随机变化（受角色控制），同一句话不会每次都一模一样
//
// 只在“短语”级别切分，绝不逐字切（避免“我。跟。你。”那种机械感）；逗号留在句子里交给语音引擎自然处理。
// 诚实的限制：一段之内的音高 / 音量无法再细调（浏览器 API 不支持），也无法加真实的呼吸声。
import type { AnimalEmotion, AnimalVoiceProfile } from './voice';
import { emotionModifier } from './voice';

export type SegmentKind = 'phrase' | 'hesitation' | 'stutter';
type Break = 'ellipsis' | 'dash' | 'stutter' | 'sentence' | 'end';

export interface SpeechSegment {
  /** 交给语音引擎朗读的文字（已去掉省略号、破折号等只表示停顿的符号） */
  text: string;
  kind: SegmentKind;
  pitch: number;
  rate: number;
  volume: number;
  /** 这一段说完后停多久（毫秒） */
  pauseAfterMs: number;
}

export interface SpeechPlan {
  /** 开口前的停顿：吸气 / 思考（不播放任何呼吸音） */
  leadInMs: number;
  segments: SpeechSegment[];
  natural: boolean;
}

const HESITATION = /^(嗯+|呃+|啊+|哦+|噢|喔|诶|欸|唔+|呵+|哼+|啧+|嘿+|哈+|咦|呜+|嘘+|哎+|呀|嗯哼|呃、?呃)$/;
const SPEAKABLE = /[^\s，。！？、…,.!?~～“”"'‘’—\-（）()《》]/g;
/** 只用于语气、不该被读出来的符号 */
const SILENT_MARKS = /[~～“”"‘’]/g;
const END_MARK = /^[。！？!?]$/;

export function speakableLength(text: string) {
  return (text.match(SPEAKABLE) ?? []).length;
}

/** 按“自然停顿点”切分台词 */
export function splitPhrases(text: string): { text: string; brk: Break; leading: boolean }[] {
  const out: { text: string; brk: Break; leading: boolean }[] = [];
  const src = text.replace(SILENT_MARKS, '').replace(/\.{3,}/g, '…').replace(/-{2,}/g, '—').trim();
  let buf = '';
  let leading = false;
  const flush = (brk: Break) => {
    const t = buf.trim();
    buf = '';
    if (!speakableLength(t)) {
      // 没有可读的字：只是停顿。开头的停顿记为“开口前先想一下”，中间的并入上一段
      if (!out.length) leading = leading || brk === 'ellipsis' || brk === 'dash';
      else if (rank(brk) > rank(out[out.length - 1].brk)) out[out.length - 1].brk = brk;
      return;
    }
    out.push({ text: t, brk, leading: false });
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '…') {
      while (src[i + 1] === '…') i++;
      flush('ellipsis');
    } else if (c === '—') {
      while (src[i + 1] === '—') i++;
      flush('dash');
    } else if (c === '、' && speakableLength(buf) <= 2) {
      // “等、等一下”：结巴，极短停顿
      flush('stutter');
    } else if (END_MARK.test(c)) {
      buf += c;
      while (i + 1 < src.length && END_MARK.test(src[i + 1])) buf += src[++i];
      flush(i + 1 < src.length ? 'sentence' : 'end');
    } else buf += c;
  }
  flush('end');
  if (out.length) {
    out[out.length - 1].brk = 'end';
    out[0].leading = leading;
  }
  return out;
}

function rank(b: Break) {
  return b === 'ellipsis' ? 4 : b === 'sentence' ? 3 : b === 'dash' ? 2 : b === 'stutter' ? 1 : 0;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface PlanOptions {
  /** false：整句一次读完、参数固定（“平直”对比 / 机器人预设） */
  natural?: boolean;
}

/**
 * 为一句台词规划语调。rng 用于自然随机变化（每次播放略有不同，但变化幅度由角色与情绪控制）。
 */
export function planSpeech(text: string, profile: AnimalVoiceProfile, emotion: AnimalEmotion, rng: () => number, o: PlanOptions = {}): SpeechPlan {
  const nat = profile.natural;
  const mod = emotionModifier(emotion, nat.emotionIntensity);
  const baseP = profile.pitch * mod.pitchMultiplier;
  const baseR = profile.speed * mod.rateMultiplier;
  const baseV = profile.volume * mod.volumeMultiplier;
  const pLo = Math.min(nat.pitch.min, baseP) * 0.97;
  const pHi = Math.max(nat.pitch.max, baseP) * 1.03;
  const rLo = Math.min(nat.rate.min, baseR) * 0.95;
  const rHi = Math.max(nat.rate.max, baseR) * 1.05;
  const finalize = (s: Omit<SpeechSegment, 'pitch' | 'rate' | 'volume'> & { pitch: number; rate: number; volume: number }): SpeechSegment => ({
    ...s,
    pitch: Math.round(clamp(s.pitch, Math.max(0.1, pLo), Math.min(2, pHi)) * 1000) / 1000,
    rate: Math.round(clamp(s.rate, Math.max(0.5, rLo), Math.min(2, rHi)) * 1000) / 1000,
    volume: Math.round(clamp(s.volume, nat.volume.min * 0.9, 1) * 1000) / 1000,
  });

  const flat = o.natural === false || (nat.pitch.variation === 0 && nat.hesitation === 0);
  if (flat) {
    const t = text.replace(SILENT_MARKS, '').trim().replace(/^[…．.]+/, '');
    return { leadInMs: 0, natural: false, segments: speakableLength(t) ? [finalize({ text: t, kind: 'phrase', pitch: baseP, rate: baseR, volume: baseV, pauseAfterMs: 0 })] : [] };
  }

  const parts = splitPhrases(text);
  const j = () => rng() * 2 - 1; // -1 ~ 1
  const pv = nat.pitch.variation * mod.pitchVariation;
  const rv = nat.rate.variation * (emotion === 'nervous' ? 1.6 : 1);
  const emph = mod.emphasis * nat.emphasis;
  const n = parts.length;
  const segments: SpeechSegment[] = parts.map((p, i) => {
    const bare = p.text.replace(/[，。！？、,.!?]/g, '');
    const kind: SegmentKind = HESITATION.test(bare) ? 'hesitation' : p.brk === 'stutter' ? 'stutter' : 'phrase';
    const last = i === n - 1;
    const question = /[？?]$/.test(p.text);
    const exclaim = /[！!]$/.test(p.text);
    let pitch = baseP * (1 + j() * pv);
    let rate = baseR * (1 + j() * rv);
    let volume = baseV * (1 + j() * nat.volume.variation);
    // 句子越往后音高越自然地往下走（陈述句的“下倾”）；问句不下倾
    if (!question) pitch *= 1 - 0.015 * i;
    if (kind === 'hesitation') {
      rate *= 0.82 - nat.hesitation * 0.08;
      volume *= 0.85;
      pitch *= emotion === 'surprised' ? 1.04 : 0.98;
    } else if (kind === 'stutter') {
      rate *= 1.08;
      volume *= 0.9;
    } else {
      if (question) pitch *= 1.04 + 0.02 * mod.emphasis;
      if (exclaim) {
        volume *= 1 + 0.06 * emph;
        rate *= 1.03;
      }
      // 很短的一句（“行。”“跟。”）：放慢、加重
      if (speakableLength(p.text) <= 2) {
        rate *= 1 - 0.1 * emph;
        volume *= 1 + 0.05 * emph;
      }
      // 自信 / 失落的陈述句结尾往下沉
      if (last && !question && !exclaim && (emotion === 'confident' || emotion === 'sad' || emotion === 'disappointed' || emotion === 'sarcastic')) pitch *= 0.975;
    }
    // 第一段稍轻（像吸了口气再开口），之后逐渐到正常音量
    if (i === 0 && n > 1) volume *= 1 - 0.04 * (0.5 + nat.breathiness);
    const pauseBase =
      p.brk === 'ellipsis'
        ? nat.pauses.long * (0.8 + 0.4 * rng()) * (kind === 'hesitation' ? 0.9 + nat.hesitation * 0.4 : 1)
        : p.brk === 'dash'
          ? nat.pauses.short * (0.7 + 0.4 * rng())
          : p.brk === 'stutter'
            ? nat.pauses.short * 0.55
            : p.brk === 'sentence'
              ? nat.pauses.medium * (0.85 + 0.3 * rng())
              : 0;
    return finalize({ text: p.text, kind, pitch, rate, volume, pauseAfterMs: Math.round(pauseBase * mod.pauseMultiplier) });
  });

  const leading = parts[0]?.leading ?? false;
  const leadInMs = Math.round(nat.breathiness * (90 + 140 * rng()) + (leading ? nat.pauses.long * mod.pauseMultiplier * (0.7 + 0.3 * rng()) : 0));
  return { leadInMs, segments, natural: true };
}

/** 估算一段的朗读时长（毫秒），没有真实语音时用来驱动口型与字幕 */
export function estimateSegmentMs(text: string, rate = 1) {
  const chars = speakableLength(text);
  const commas = (text.match(/[，、,]/g) ?? []).length;
  return Math.round((chars / (5.2 * rate)) * 1000 + commas * 160 + 120);
}

/** 整句的时间轴：[开始, 结束] 毫秒（相对开口前），口型只在说话的时间段内动 */
export function planTimeline(plan: SpeechPlan, rateMul = 1): { windows: [number, number][]; totalMs: number } {
  let t = plan.leadInMs;
  const windows: [number, number][] = [];
  for (const s of plan.segments) {
    const d = estimateSegmentMs(s.text, s.rate * rateMul);
    windows.push([t, t + d]);
    t += d + s.pauseAfterMs;
  }
  return { windows, totalMs: t };
}
