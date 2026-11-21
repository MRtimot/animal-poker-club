// 动物角色的声音与性格（客户端与服务器共享的数据，不含任何播放代码）
//
// 说明：本项目没有接入任何付费 AI 语音服务。声音由浏览器自带的语音合成（SpeechSynthesis）播放，
// 不同动物的差异来自：可用系统语音的选择 + 音高 + 语速 + 音量 + 情绪调整 + 台词风格。
import type { AnimalConfig, Species } from '../player/profile';

export type AnimalEmotion =
  | 'neutral'
  | 'happy'
  | 'angry'
  | 'sad'
  | 'nervous'
  | 'excited'
  | 'confident'
  | 'surprised'
  | 'sarcastic'
  | 'confused'
  | 'disappointed';

export const EMOTIONS: AnimalEmotion[] = ['neutral', 'happy', 'angry', 'sad', 'nervous', 'excited', 'confident', 'surprised', 'sarcastic', 'confused', 'disappointed'];

export const EMOTION_NAME: Record<AnimalEmotion, string> = {
  neutral: '平静',
  happy: '开心',
  angry: '生气',
  sad: '失落',
  nervous: '紧张',
  excited: '兴奋',
  confident: '自信',
  surprised: '惊讶',
  sarcastic: '嘲讽',
  confused: '疑惑',
  disappointed: '失望',
};

/** 台词风格：决定动物“怎么说话”（每种动物属于一种风格） */
export type SpeechStyle = 'cool' | 'regal' | 'smug' | 'mysterious' | 'friendly' | 'nervous' | 'heavy' | 'playful';

export interface AnimalVoiceProfile {
  voiceId: string;
  animalId: Species;
  displayName: string;
  language: string;
  /** 浏览器语音合成的音高（0~2，1 = 正常） */
  pitch: number;
  /** 语速（1 = 正常） */
  speed: number;
  volume: number;
  /** 偏好的系统语音类型（实际可用的语音取决于设备） */
  gender: 'male' | 'female' | 'any';
  /**
   * 偏好的系统语音（名字关键词，按顺序尝试）。各平台自带的中文语音不同：
   * macOS / iOS：Reed、Rocko、Eddy、Grandpa、Flo、Sandy、Shelley、Grandma、Tingting；
   * Windows：Kangkang、Huihui、Yaoyao；Edge 在线语音：Yunxi、Yunjian、Xiaoxiao、Xiaoyi…
   * 设备上没有时自动回退到同性别 / 任意中文语音。
   */
  voiceHints: string[];
  style: SpeechStyle;
  /** 各种情绪下的说话方式（描述，用于调试面板与未来接入 AI 语音） */
  emotion: Record<AnimalEmotion, string>;
  personality: {
    tone: string;
    speakingStyle: string;
    vocabulary: string;
    sentenceLength: string;
  };
  /** 自然说话参数：每句话的音高 / 语速 / 音量都会在这个范围内自然变化 */
  natural: NaturalSpeechProfile;
}

/**
 * 自然说话模型：不让每句话都用完全一样的参数。
 * 变化幅度由角色决定（狼很稳、兔子很飘），情绪再在上面叠加。
 */
export interface NaturalSpeechProfile {
  baseVoice: string;
  pitch: { min: number; max: number; variation: number };
  rate: { min: number; max: number; variation: number };
  volume: { min: number; max: number; variation: number };
  /** 停顿时长（毫秒）：short = 结巴 / 破折号，medium = 句与句之间，long = 省略号（犹豫、思考） */
  pauses: { short: number; medium: number; long: number };
  /** 情绪表达强度 0~1：越高，情绪对声音的影响越明显 */
  emotionIntensity: number;
  /**
   * 呼吸感 0~1。浏览器语音合成无法生成真实的呼吸声，这里不伪造呼吸音，
   * 只用“开口前的极短停顿 + 第一小句稍轻”来模拟吸气后开口的节奏。
   */
  breathiness: number;
  /** 重音强度 0~1：短句、感叹句会更慢、更重 */
  emphasis: number;
  /** 犹豫程度 0~1：越高，“嗯……”之后停得越久、语速越不稳 */
  hesitation: number;
}

export interface AnimalPersonality {
  animalId: Species;
  name: string;
  personalityTraits: string[];
  speakingStyle: string;
  pokerStyle: string;
  emotionalRange: AnimalEmotion[];
  catchphrases: string[];
  /** 0~1 */
  aggression: number;
  confidence: number;
  bluffFrequency: number;
  humor: number;
  friendliness: number;
  /** 说话频率（0~1）：越高越爱说话 */
  talkativeness: number;
}

/** 情绪对声音的影响（乘在角色基础声音上；初始值，按实际听感调整过） */
export interface EmotionVoiceModifier {
  pitchMultiplier: number;
  rateMultiplier: number;
  volumeMultiplier: number;
  /** 句与句之间音高变化的幅度倍数（紧张时更飘，自信时更稳） */
  pitchVariation: number;
  /** 停顿时长倍数 */
  pauseMultiplier: number;
  /** 重音 0~1 */
  emphasis: number;
}

const EM = (pitchMultiplier: number, rateMultiplier: number, volumeMultiplier: number, pitchVariation: number, pauseMultiplier: number, emphasis: number): EmotionVoiceModifier => ({
  pitchMultiplier,
  rateMultiplier,
  volumeMultiplier,
  pitchVariation,
  pauseMultiplier,
  emphasis,
});

export const EMOTION_VOICE: Record<AnimalEmotion, EmotionVoiceModifier> = {
  neutral: EM(1, 1, 1, 1, 1, 0.5),
  confident: EM(0.95, 0.95, 1.05, 0.7, 1, 0.9),
  happy: EM(1.06, 1.05, 1.05, 1.2, 0.9, 0.6),
  angry: EM(0.94, 1.1, 1.1, 0.8, 0.8, 1),
  nervous: EM(1.08, 1.08, 0.97, 1.6, 1.2, 0.5),
  excited: EM(1.08, 1.12, 1.08, 1.4, 0.9, 0.9),
  sad: EM(0.92, 0.88, 0.9, 0.6, 1.2, 0.2),
  surprised: EM(1.12, 1.04, 1.06, 1.3, 0.9, 0.8),
  sarcastic: EM(0.98, 0.93, 1, 1.3, 1.15, 0.8),
  confused: EM(1.04, 0.92, 0.95, 1.3, 1.25, 0.3),
  disappointed: EM(0.93, 0.9, 0.92, 0.6, 1.2, 0.3),
};

/** 角色情绪强度会放大 / 减弱情绪修正（冷静的狼情绪变化小，傲娇的猫变化大） */
export function emotionModifier(emotion: AnimalEmotion, intensity = 0.75): EmotionVoiceModifier {
  const m = EMOTION_VOICE[emotion] ?? EMOTION_VOICE.neutral;
  const k = 0.6 + 0.6 * Math.max(0, Math.min(1, intensity));
  const scale = (x: number) => 1 + (x - 1) * k;
  return { ...m, pitchMultiplier: scale(m.pitchMultiplier), rateMultiplier: scale(m.rateMultiplier), volumeMultiplier: scale(m.volumeMultiplier) };
}

/** 每种动物偏好的系统语音（不同平台的名字都列上，按顺序尝试） */
const HINTS: Record<Species, string[]> = {
  wolf: ['reed', 'yunjian', 'kangkang'],
  fox: ['flo', 'xiaoyi', 'meijia'],
  cat: ['shelley', 'xiaoxiao', 'huihui'],
  dog: ['eddy', 'yunxi', 'kangkang'],
  rabbit: ['sandy', 'xiaoyi', 'yaoyao'],
  bear: ['grandpa', 'yunyang', 'kangkang'],
  tiger: ['rocko', 'yunjian', 'kangkang'],
  panda: ['grandma', 'xiaoxiao', 'huihui'],
  lion: ['rocko', 'yunyang', 'kangkang'],
  monkey: ['eddy', 'yunxi', 'kangkang'],
  raccoon: ['reed', 'yunxi', 'kangkang'],
  koala: ['grandma', 'xiaoyi', 'yaoyao'],
  frog: ['eddy', 'yunxi', 'kangkang'],
  penguin: ['reed', 'yunyang', 'kangkang'],
  dragon: ['grandpa', 'yunjian', 'kangkang'],
};

const em = (o: Partial<Record<AnimalEmotion, string>>, base: string): Record<AnimalEmotion, string> =>
  Object.fromEntries(EMOTIONS.map((k) => [k, o[k] ?? base])) as Record<AnimalEmotion, string>;

/**
 * 每种动物的说话节奏：[音高变化, 语速变化, 音量变化, 短停顿, 中停顿, 长停顿, 情绪强度, 呼吸感, 重音, 犹豫]
 * 狼：稳、慢、停顿长；兔子：飘、快、爱犹豫；考拉：慢半拍；青蛙：忽快忽慢。
 */
const NATURAL: Record<Species, [number, number, number, number, number, number, number, number, number, number]> = {
  wolf: [0.02, 0.03, 0.04, 140, 340, 680, 0.55, 0.35, 0.85, 0.25],
  fox: [0.03, 0.04, 0.05, 160, 360, 640, 0.75, 0.4, 0.6, 0.45],
  cat: [0.05, 0.06, 0.07, 110, 260, 480, 1, 0.2, 0.75, 0.25],
  dog: [0.04, 0.05, 0.06, 90, 220, 400, 0.9, 0.25, 0.7, 0.15],
  rabbit: [0.06, 0.1, 0.07, 80, 200, 440, 1, 0.3, 0.5, 0.85],
  bear: [0.02, 0.03, 0.04, 180, 380, 700, 0.5, 0.5, 0.5, 0.5],
  tiger: [0.03, 0.04, 0.05, 100, 240, 460, 0.8, 0.2, 0.95, 0.1],
  panda: [0.03, 0.04, 0.04, 180, 380, 720, 0.6, 0.45, 0.4, 0.55],
  lion: [0.025, 0.03, 0.05, 140, 320, 600, 0.7, 0.3, 0.95, 0.1],
  monkey: [0.06, 0.08, 0.07, 80, 200, 380, 1, 0.2, 0.7, 0.2],
  raccoon: [0.035, 0.05, 0.05, 130, 300, 560, 0.7, 0.35, 0.55, 0.4],
  koala: [0.025, 0.04, 0.04, 220, 450, 800, 0.5, 0.55, 0.35, 0.7],
  frog: [0.07, 0.12, 0.08, 70, 190, 520, 1, 0.15, 0.7, 0.3],
  penguin: [0.02, 0.025, 0.03, 130, 300, 520, 0.5, 0.25, 0.6, 0.15],
  dragon: [0.02, 0.03, 0.04, 200, 420, 780, 0.6, 0.5, 0.85, 0.2],
};

const clampP = (x: number) => Math.max(0.1, Math.min(2, x));
const clampR = (x: number) => Math.max(0.5, Math.min(2, x));

/** 由角色基础音高 / 语速生成自然说话参数（自定义声音时会重新计算范围） */
export function naturalProfile(species: Species, voiceId: string, pitch: number, speed: number): NaturalSpeechProfile {
  const [pv, rv, vv, short, medium, long, emotionIntensity, breathiness, emphasis, hesitation] = NATURAL[species] ?? NATURAL.cat;
  return {
    baseVoice: voiceId,
    pitch: { min: clampP(pitch * (1 - pv * 4)), max: clampP(pitch * (1 + pv * 4)), variation: pv },
    rate: { min: clampR(speed * (1 - rv * 4)), max: clampR(speed * (1 + rv * 4)), variation: rv },
    volume: { min: 0.55, max: 1, variation: vv },
    pauses: { short, medium, long },
    emotionIntensity,
    breathiness,
    emphasis,
    hesitation,
  };
}

type VoiceSeed = [Species, string, number, number, AnimalVoiceProfile['gender'], SpeechStyle, AnimalVoiceProfile['personality'], Partial<Record<AnimalEmotion, string>>];

const SEEDS: VoiceSeed[] = [
  ['wolf', '狼', 0.62, 0.86, 'male', 'cool', { tone: '低沉、冷静、有压迫感', speakingStyle: '短句、低调、很少解释', vocabulary: '简洁，带一点威胁', sentenceLength: '短' }, { angry: '压低声音，咬字更重', confident: '慢，几乎不带情绪' }],
  ['fox', '狐狸', 1.05, 0.95, 'female', 'mysterious', { tone: '温柔、聪明、带一点神秘', speakingStyle: '意味深长，喜欢留半句', vocabulary: '文雅，爱说“有意思”', sentenceLength: '中' }, { happy: '轻笑，语调上扬', confident: '慢条斯理' }],
  ['cat', '猫', 1.32, 1.1, 'female', 'smug', { tone: '傲娇、轻快、带挑衅', speakingStyle: '先“哼”一声再说话', vocabulary: '嘴硬，爱反问', sentenceLength: '短' }, { angry: '尖一点、快一点', happy: '得意地拖长尾音' }],
  ['dog', '狗', 1.15, 1.15, 'male', 'friendly', { tone: '热情、友好、元气', speakingStyle: '感叹号很多，真诚', vocabulary: '口语化，爱夸人', sentenceLength: '中' }, { sad: '委屈巴巴', excited: '又快又高' }],
  ['rabbit', '兔子', 1.62, 1.3, 'female', 'nervous', { tone: '偏高、紧张、慌张', speakingStyle: '结巴、重复、语速快', vocabulary: '“等、等一下”', sentenceLength: '短而碎' }, { nervous: '更快更高', happy: '雀跃' }],
  ['bear', '熊', 0.55, 0.8, 'male', 'heavy', { tone: '厚重、缓慢、憨厚', speakingStyle: '慢吞吞，不急不躁', vocabulary: '朴实', sentenceLength: '中' }, { angry: '低吼', happy: '憨笑' }],
  ['tiger', '老虎', 0.72, 1.02, 'male', 'regal', { tone: '强势、有威严', speakingStyle: '命令式，不容反驳', vocabulary: '霸气', sentenceLength: '短' }, { angry: '吼叫般', confident: '居高临下' }],
  ['panda', '熊猫', 1.18, 0.78, 'any', 'heavy', { tone: '慢悠悠、可爱', speakingStyle: '拖长音，不慌不忙', vocabulary: '软萌', sentenceLength: '中' }, { nervous: '慢慢地慌', happy: '眯眼笑' }],
  ['lion', '狮子', 0.6, 0.9, 'male', 'regal', { tone: '威严、霸气', speakingStyle: '像国王一样宣布', vocabulary: '庄重', sentenceLength: '中' }, { confident: '沉稳有力' }],
  ['monkey', '猴子', 1.48, 1.32, 'male', 'playful', { tone: '活泼、调皮', speakingStyle: '嘻嘻哈哈，爱开玩笑', vocabulary: '俏皮话', sentenceLength: '短' }, { excited: '大叫大笑' }],
  ['raccoon', '浣熊', 1.12, 1.1, 'male', 'mysterious', { tone: '狡黠、小声', speakingStyle: '像在说悄悄话', vocabulary: '精明', sentenceLength: '中' }, {}],
  ['koala', '考拉', 1.08, 0.72, 'any', 'heavy', { tone: '迷糊、慢', speakingStyle: '像刚睡醒', vocabulary: '简单', sentenceLength: '短' }, { surprised: '慢半拍的惊讶' }],
  ['frog', '青蛙', 1.4, 1.25, 'male', 'playful', { tone: '疯癫、跳脱', speakingStyle: '忽快忽慢', vocabulary: '“呱”', sentenceLength: '短' }, {}],
  ['penguin', '企鹅', 0.95, 1.0, 'male', 'cool', { tone: '冷静、绅士', speakingStyle: '礼貌但冷淡', vocabulary: '正式', sentenceLength: '中' }, {}],
  ['dragon', '龙', 0.5, 0.84, 'male', 'regal', { tone: '古老、低沉、神秘', speakingStyle: '像传说一样缓慢', vocabulary: '古风', sentenceLength: '中' }, {}],
];

export const VOICE_PROFILES: Record<Species, AnimalVoiceProfile> = Object.fromEntries(
  SEEDS.map(([id, name, pitch, speed, gender, style, personality, emo]) => [
    id,
    {
      voiceId: `voice.${id}`,
      animalId: id,
      displayName: name,
      language: 'zh-CN',
      pitch,
      speed,
      volume: 1,
      gender,
      voiceHints: HINTS[id],
      style,
      emotion: em(emo, personality.tone),
      personality,
      natural: naturalProfile(id, `voice.${id}`, pitch, speed),
    } satisfies AnimalVoiceProfile,
  ]),
) as Record<Species, AnimalVoiceProfile>;

type PersonaSeed = [Species, string[], string, number, number, number, number, number, number, string[]];

const PERSONA: PersonaSeed[] = [
  ['wolf', ['冷静', '自信', '具有攻击性'], '激进、喜欢施压', 0.8, 0.85, 0.65, 0.2, 0.3, 0.45, ['……你在怕什么？']],
  ['fox', ['狡猾', '聪明', '神秘'], '善于诈唬，读人很准', 0.6, 0.8, 0.7, 0.5, 0.5, 0.6, ['有意思……']],
  ['cat', ['傲娇', '挑剔', '好胜'], '看心情，嘴上从不服输', 0.55, 0.75, 0.45, 0.6, 0.35, 0.65, ['哼，才不是运气。']],
  ['dog', ['热情', '忠诚', '乐观'], '稳健，偶尔冲动', 0.45, 0.6, 0.25, 0.6, 0.9, 0.7, ['大家玩得开心！']],
  ['rabbit', ['紧张', '可爱', '运气好'], '随心所欲，手气型', 0.5, 0.35, 0.3, 0.5, 0.8, 0.6, ['今、今天运气不错！']],
  ['bear', ['憨厚', '稳重', '慢热'], '保守，筹码堆得像山', 0.35, 0.65, 0.15, 0.4, 0.75, 0.35, ['慢慢来……']],
  ['tiger', ['霸气', '急躁', '强势'], '一言不合就加注', 0.85, 0.85, 0.55, 0.25, 0.3, 0.55, ['这张桌子我说了算。']],
  ['panda', ['佛系', '耐心', '可爱'], '只玩强牌，很少诈唬', 0.25, 0.6, 0.1, 0.55, 0.85, 0.4, ['不急，竹子还多着呢。']],
  ['lion', ['威严', '骄傲', '领袖'], '大开大合，喜欢大底池', 0.75, 0.95, 0.5, 0.3, 0.45, 0.5, ['跪下吧，王者在此。']],
  ['monkey', ['调皮', '机灵', '爱捣乱'], '变化多端，喜欢偷鸡', 0.65, 0.6, 0.7, 0.9, 0.6, 0.85, ['嘿嘿，猜猜我有什么？']],
  ['raccoon', ['精明', '神秘', '小心'], '偷偷摸摸，伺机而动', 0.5, 0.65, 0.6, 0.5, 0.45, 0.5, ['嘘——别出声。']],
  ['koala', ['迷糊', '温和', '慢半拍'], '看起来在睡，其实在算牌', 0.3, 0.55, 0.3, 0.6, 0.7, 0.35, ['啊……轮到我了吗？']],
  ['frog', ['疯狂', '跳脱', '不可预测'], '忽紧忽松，谁也看不透', 0.7, 0.55, 0.75, 0.85, 0.55, 0.75, ['呱！全都跳进来！']],
  ['penguin', ['冷静', '绅士', '克制'], '纪律严明，按数学打牌', 0.4, 0.75, 0.3, 0.35, 0.55, 0.4, ['请多指教。']],
  ['dragon', ['古老', '强大', '神秘'], '深不可测，耐心等待猎物', 0.7, 1, 0.5, 0.3, 0.3, 0.4, ['凡人，接受命运吧。']],
];

export const PERSONALITIES_BY_SPECIES: Record<Species, AnimalPersonality> = Object.fromEntries(
  PERSONA.map(([id, traits, pokerStyle, aggression, confidence, bluffFrequency, humor, friendliness, talkativeness, catchphrases]) => [
    id,
    {
      animalId: id,
      name: VOICE_PROFILES[id].displayName,
      personalityTraits: traits,
      speakingStyle: VOICE_PROFILES[id].personality.speakingStyle,
      pokerStyle,
      emotionalRange: EMOTIONS,
      catchphrases,
      aggression,
      confidence,
      bluffFrequency,
      humor,
      friendliness,
      talkativeness,
    } satisfies AnimalPersonality,
  ]),
) as Record<Species, AnimalPersonality>;

// ───────────── 玩家自定义角色的声音 ─────────────

export type VoicePresetId = 'auto' | 'deep' | 'normal' | 'high' | 'cute' | 'funny' | 'serious' | 'villain' | 'robot';

export const VOICE_PRESETS: { id: VoicePresetId; name: string; pitch?: number; speed?: number; gender?: AnimalVoiceProfile['gender']; style?: SpeechStyle; hints?: string[] }[] = [
  { id: 'auto', name: '自动（按动物）' },
  { id: 'deep', name: '低沉', pitch: 0.55, speed: 0.88, gender: 'male', style: 'cool', hints: ['grandpa', 'yunjian', 'kangkang'] },
  { id: 'normal', name: '普通', pitch: 1, speed: 1, gender: 'any', style: 'friendly', hints: ['tingting', 'xiaoxiao', 'huihui'] },
  { id: 'high', name: '高音', pitch: 1.6, speed: 1.15, gender: 'female', style: 'nervous', hints: ['sandy', 'xiaoyi', 'yaoyao'] },
  { id: 'cute', name: '可爱', pitch: 1.75, speed: 1.05, gender: 'female', style: 'playful', hints: ['sandy', 'xiaoyi', 'yaoyao'] },
  { id: 'funny', name: '搞笑', pitch: 1.45, speed: 1.35, gender: 'any', style: 'playful', hints: ['eddy', 'yunxi', 'kangkang'] },
  { id: 'serious', name: '严肃', pitch: 0.8, speed: 0.9, gender: 'male', style: 'cool', hints: ['reed', 'yunyang', 'kangkang'] },
  { id: 'villain', name: '反派', pitch: 0.5, speed: 0.8, gender: 'male', style: 'mysterious', hints: ['rocko', 'yunjian', 'kangkang'] },
  { id: 'robot', name: '机器人', pitch: 0.9, speed: 0.75, gender: 'any', style: 'cool', hints: ['reed', 'yunyang', 'kangkang'] },
];

/** 保存在动物配置里的声音设置（动物创建器中修改） */
export interface AnimalVoiceSettings {
  preset: VoicePresetId;
  /** 在预设基础上的微调：-0.5 ~ +0.5 */
  pitch: number;
  rate: number;
}

export function sanitizeVoiceSettings(v: unknown): AnimalVoiceSettings | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as any;
  const preset = VOICE_PRESETS.some((p) => p.id === o.preset) ? (o.preset as VoicePresetId) : 'auto';
  const clamp = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(Math.max(-0.5, Math.min(0.5, x)) * 100) / 100 : 0);
  return { preset, pitch: clamp(o.pitch), rate: clamp(o.rate) };
}

/** 动物最终使用的声音：物种声音 + 玩家在创建器中的设置 */
export function resolveVoiceProfile(animal: Pick<AnimalConfig, 'species' | 'voice'>): AnimalVoiceProfile {
  const base = VOICE_PROFILES[animal.species] ?? VOICE_PROFILES.cat;
  const v = animal.voice;
  if (!v) return base;
  const preset = VOICE_PRESETS.find((p) => p.id === v.preset);
  const usePreset = preset && preset.id !== 'auto';
  const voiceId = usePreset ? `${base.voiceId}.${preset.id}` : base.voiceId;
  const pitch = clampP((usePreset && preset.pitch !== undefined ? preset.pitch : base.pitch) + v.pitch);
  const speed = clampR((usePreset && preset.speed !== undefined ? preset.speed : base.speed) + v.rate);
  const natural = naturalProfile(animal.species, voiceId, pitch, speed);
  // “机器人”预设：故意去掉自然变化（玩家自己选的效果）
  if (preset?.id === 'robot') Object.assign(natural, { pitch: { ...natural.pitch, variation: 0 }, rate: { ...natural.rate, variation: 0 }, volume: { ...natural.volume, variation: 0 }, breathiness: 0, hesitation: 0 });
  return {
    ...base,
    voiceId,
    pitch,
    speed,
    gender: usePreset && preset.gender ? preset.gender : base.gender,
    voiceHints: usePreset && preset.hints ? preset.hints : base.voiceHints,
    style: usePreset && preset.style ? preset.style : base.style,
    natural,
  };
}
