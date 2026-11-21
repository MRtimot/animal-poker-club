// 播放一句角色台词：字幕气泡 + 情绪表情 + 说话动画 + 本地语音（浏览器语音合成）
// 在线对局与本地 AI 对局共用：台词由服务器 / 本地控制器决定，这里只负责表现。
//
// 流程：情绪 → 语调规划（分段、停顿、音高 / 语速变化）→ 语音引擎逐段播放 → 口型 / 头部跟着每一段动
import type { AnimalConfig } from '../core/player/profile';
import { SPECIES_MAP } from '../core/player/profile';
import { DIALOGUE_PRIORITY, type DialogueRef } from '../core/character/dialogue';
import { resolveVoiceProfile, type AnimalEmotion } from '../core/character/voice';
import { planSpeech, planTimeline } from '../core/character/prosody';
import { useFx, type AnimName, type MoodFace } from '../store/fxStore';
import { useSettings } from '../store/settingsStore';
import { voice, type VoiceResult } from '../audio/voice';

const EMOTION_FACE: Record<AnimalEmotion, { face: MoodFace; emoji: string; anim?: AnimName } | null> = {
  neutral: null,
  happy: { face: 'happy', emoji: '😊', anim: 'happy' },
  angry: { face: 'angry', emoji: '😠', anim: 'angry' },
  sad: { face: 'sad', emoji: '😞' },
  nervous: { face: 'wide', emoji: '😰', anim: 'nervous' },
  excited: { face: 'happy', emoji: '🤩', anim: 'happy' },
  confident: { face: 'smug', emoji: '😏', anim: 'smug' },
  surprised: { face: 'wide', emoji: '😮', anim: 'surprised' },
  sarcastic: { face: 'smug', emoji: '😏', anim: 'smug' },
  confused: { face: 'wide', emoji: '🤔' },
  disappointed: { face: 'sad', emoji: '😮‍💨' },
};

export interface PlayOptions {
  name: string;
  /** 是否播放语音（调试“只测试动画”时为 false） */
  withVoice?: boolean;
  /** 是否显示字幕气泡（默认按玩家设置） */
  bubble?: boolean;
  /** 强制自然 / 平直语调（调试对比用；默认按玩家设置） */
  natural?: boolean;
}

/** 返回语音结果：spoken / text-only / interrupted / skipped / off（玩家关闭了语音） */
export function playDialogue(speakerId: string, text: string, ref: Pick<DialogueRef, 'emotion' | 'event'>, animal: AnimalConfig, o: PlayOptions): Promise<VoiceResult | 'off'> {
  const s = useSettings.getState();
  const fx = useFx.getState();
  const profile = resolveVoiceProfile(animal);
  const emotion = ref.emotion;
  const plan = planSpeech(text, profile, emotion, Math.random, { natural: o.natural ?? s.voiceNatural });
  const { windows, totalMs } = planTimeline(plan, s.voiceRate);
  const rate = (plan.segments[0]?.rate ?? profile.speed) * s.voiceRate;
  const emoji = SPECIES_MAP[animal.species]?.emoji ?? '🐾';

  if (o.bubble ?? s.subtitles) fx.bubble(speakerId, text, 'dialogue', { speaker: `${emoji} ${o.name}`, ms: totalMs + 1600 });
  const f = EMOTION_FACE[emotion];
  if (f) {
    fx.setMood(speakerId, f.emoji, f.face, totalMs + 900);
    if (f.anim) fx.play(speakerId, f.anim);
  }
  // 先按语调规划的时间轴动嘴（没有语音时也会按停顿开合），真正开始发声时再改为跟着语音事件走
  const startAt = performance.now();
  fx.speakStart(speakerId, {
    emotion,
    until: startAt + totalMs,
    voiced: false,
    rate,
    windows: windows.map(([a, b]) => [startAt + a, startAt + b] as [number, number]),
    hesitating: plan.segments[0]?.kind === 'hesitation',
  });

  if (o.withVoice === false || !s.voiceEnabled || s.voiceVolume <= 0) return Promise.resolve('off');
  // 剩余时长估算（用于每段开始后更新结束时间）
  const tail = (from: number) => {
    let t = 0;
    for (let i = from; i < plan.segments.length; i++) {
      const [a, b] = windows[i];
      t += b - a + (i < plan.segments.length - 1 ? plan.segments[i].pauseAfterMs : 0);
    }
    return t;
  };
  const upd = (patch: Parameters<ReturnType<typeof useFx.getState>['speakUpdate']>[1]) => useFx.getState().speakUpdate(speakerId, patch);
  return voice
    .speak(text, profile, {
      emotion,
      plan,
      priority: DIALOGUE_PRIORITY[ref.event] ?? 1,
      volume: s.voiceVolume,
      rate: s.voiceRate,
      onStart: () => upd({ start: performance.now(), voiced: true, windows: undefined }),
      onSegment: (i, seg) => {
        const now = performance.now();
        upd({ gap: false, pulse: now, hesitating: seg.kind === 'hesitation', rate: seg.rate * s.voiceRate, until: now + tail(i) * 1.25 + 400 });
      },
      onPause: (i, ms) => {
        const now = performance.now();
        upd({ gap: true, until: now + ms + tail(i + 1) * 1.25 + 400 });
      },
      onBoundary: () => upd({ pulse: performance.now() }),
      onEnd: () => useFx.getState().speakEnd(speakerId),
    })
    .then((r) => {
      if (r === 'interrupted' || r === 'skipped') useFx.getState().speakEnd(speakerId);
      return r;
    });
}

/** 玩家设置是否允许显示 / 播放这句台词 */
export function dialogueAllowed(ref: DialogueRef) {
  const s = useSettings.getState();
  if (!s.aiTalk) return false;
  if (ref.taunt && !s.trashTalk) return false;
  return true;
}
