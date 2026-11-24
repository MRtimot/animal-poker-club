// 视觉效果状态：动物动画、筹码飞行、表情气泡、镜头提示、粒子
import { create } from 'zustand';

export type AnimName =
  | 'idle' | 'talk' | 'happy' | 'sad' | 'nervous' | 'angry' | 'surprised'
  | 'win' | 'lose' | 'bet' | 'raise' | 'fold' | 'allin' | 'think'
  | 'laugh' | 'shock' | 'cool' | 'fire' | 'dead' | 'clap' | 'love' | 'wave'
  | 'stretch' | 'settle' | 'doubt' | 'smug' | 'peek'
  // 失败演出（animation/defeat）：意识到输了 / 冲击后的倒下（按动物种类）/ 赢家与旁观者的反应
  | 'realizeDisbelief' | 'realizePanic' | 'realizeFade' | 'realizeAccept' | 'realizeAnger'
  | 'collapseSlump' | 'collapseFaint' | 'collapseDignified' | 'collapseRage' | 'collapseDrama' | 'collapseAnnoyed' | 'collapseEmbarrassed'
  | 'defeatRecoil' | 'stackChips' | 'stare' | 'lookAway' | 'flinch';

export const ANIM_DURATION: Record<AnimName, number> = {
  idle: 0, talk: 1.6, happy: 1.6, sad: 2.2, nervous: 2, angry: 1.8, surprised: 1.4,
  win: 3.6, lose: 3.2, bet: 1.1, raise: 1.4, fold: 1.5, allin: 2.6, think: 0,
  laugh: 2.2, shock: 1.8, cool: 3.5, fire: 2, dead: 2.4, clap: 2, love: 2.2, wave: 1.8,
  stretch: 2.2, settle: 1.2, doubt: 1.8, smug: 2, peek: 1.6,
  realizeDisbelief: 2.8, realizePanic: 2.8, realizeFade: 2.8, realizeAccept: 2.8, realizeAnger: 2.8,
  // 倒下后保持倒下的姿势，直到演出结束（结束时播放 settle 回到坐姿；完整版在黑屏中恢复）
  collapseSlump: 40, collapseFaint: 40, collapseDignified: 40, collapseRage: 40, collapseDrama: 40, collapseAnnoyed: 40, collapseEmbarrassed: 40,
  defeatRecoil: 2.4, stackChips: 2.4, stare: 4.5, lookAway: 3, flinch: 0.9,
};

/** 表情（情绪系统）：会改变动物脸部，并在头顶短暂显示 */
export type MoodFace = 'normal' | 'happy' | 'wide' | 'sad' | 'angry' | 'smug' | 'doubt' | 'x';
export type ShoutKind = 'allin' | 'street' | 'tie' | 'end' | 'hand';

export interface Mood {
  emoji: string;
  face: MoodFace;
  start: number; // ms
  until: number; // ms
}

export interface AnimState {
  name: AnimName;
  start: number; // performance.now() / 1000
}

export interface ChipFlight {
  id: number;
  from: [number, number, number];
  to: [number, number, number];
  amount: number;
  start: number; // ms (performance.now)
  duration: number;
  /** 抬起高度：下注贴着桌面滑动（约 0.05），派奖略高 */
  arc?: number;
}

export interface Bubble {
  id: number;
  playerId: string;
  text: string;
  kind: 'chat' | 'emote' | 'dialogue';
  until: number;
  /** 角色台词：显示“🐺 狼”这样的说话者 */
  speaker?: string;
}

/** 角色说话状态：驱动嘴巴、头、耳朵、眼睛的说话动画 */
export interface SpeechState {
  /** idle → thinking（AI 在想）→ speaking → finished */
  phase: 'speaking' | 'finished';
  emotion: string;
  start: number; // performance.now()
  until: number; // 预计结束时间（真实语音结束时会更新）
  /** 最近一次词边界（语音合成的 boundary 事件），口型在这时张得更大 */
  pulse: number;
  /** 是否真的在播放语音（否则只有字幕和口型） */
  voiced: boolean;
  /** 语速：影响口型节奏 */
  rate: number;
  /** 没有真实语音时：按语调规划估算的“正在说话”时间段（绝对时间），段与段之间嘴巴闭上 */
  windows?: [number, number][];
  /** 有真实语音时：当前处在两段之间的停顿（嘴巴闭上、头部有个小停顿） */
  gap?: boolean;
  /** 当前这一段是犹豫词（“嗯……”）：嘴巴张得小、眼神移开 */
  hesitating?: boolean;
}

export interface CameraCue {
  type: 'action' | 'allin' | 'showdown' | 'win' | 'flop' | 'turn' | 'river' | 'intro';
  playerId?: string;
  start: number; // ms
  duration: number;
}

/** 赢家演出（由事件导演在派奖时刻触发，界面只负责展示） */
export interface WinPresentation {
  id: number;
  hand: number;
  uncontested: boolean;
  tie: boolean;
  winners: { playerId: string; amount: number; handName?: string; cards: import('../core/cards/card').Card[] }[];
  start: number; // performance.now()
  duration: number;
}

export interface Burst {
  id: number;
  position: [number, number, number];
  kind: 'confetti' | 'sparkle' | 'hearts' | 'fire' | 'gold' | 'poof';
  start: number;
}

interface FxState {
  anims: Record<string, AnimState>;
  flights: ChipFlight[];
  bubbles: Bubble[];
  cue: CameraCue | null;
  bursts: Burst[];
  coolUntil: Record<string, number>;
  moods: Record<string, Mood>;
  speech: Record<string, SpeechState>;
  speakStart: (playerId: string, s: Omit<SpeechState, 'phase' | 'pulse' | 'start'> & { start?: number }) => void;
  speakUpdate: (playerId: string, patch: Partial<SpeechState>) => void;
  speakEnd: (playerId: string) => void;
  /** 镜头震动 */
  shake: { amp: number; start: number };
  /** 桌面灯光增强（0~1） */
  light: { level: number; start: number; duration: number };
  /** 屏幕中央的大字提示（全押！/ 翻牌 / 转牌 / 河牌 / 平局！） */
  announce: { id: number; text: string; kind: ShoutKind; start: number } | null;
  shout: (text: string, kind: ShoutKind) => void;
  setMood: (playerId: string, emoji: string, face: MoodFace, ms?: number) => void;
  doShake: (amp: number) => void;
  /** 大底池紧张度 0~1 */
  tension: number;
  setTension: (v: number) => void;
  boostLight: (level: number, ms: number) => void;
  play: (playerId: string, name: AnimName) => void;
  flyChips: (f: Omit<ChipFlight, 'id' | 'start'> & { delay?: number }) => void;
  bubble: (playerId: string, text: string, kind: Bubble['kind'], extra?: { speaker?: string; ms?: number }) => void;
  setCue: (c: Omit<CameraCue, 'start'> | null) => void;
  burst: (position: [number, number, number], kind: Burst['kind']) => void;
  setCool: (playerId: string, ms: number) => void;
  /**
   * 已经“演出”到的事件序号：事件导演按节奏播放事件，每播放一个就推进这个游标。
   * 底池数字、牌局记录等需要与动画同步的界面只显示游标之前的事件（避免数字先变、筹码后到，或提前剧透摊牌结果）。
   */
  shown: { hand: number; seq: number };
  markShown: (hand: number, seq: number) => void;
  presentation: WinPresentation | null;
  present: (p: Omit<WinPresentation, 'id' | 'start'>) => void;
  cleanup: () => void;
  reset: () => void;
}

let fid = 1;

export const useFx = create<FxState>()((set, get) => ({
  anims: {},
  flights: [],
  bubbles: [],
  cue: null,
  bursts: [],
  coolUntil: {},
  moods: {},
  speech: {},
  speakStart: (playerId, sp) => {
    const now = performance.now();
    set({ speech: { ...get().speech, [playerId]: { ...sp, start: sp.start ?? now, phase: 'speaking', pulse: 0 } } });
  },
  speakUpdate: (playerId, patch) => {
    const cur = get().speech[playerId];
    if (cur) set({ speech: { ...get().speech, [playerId]: { ...cur, ...patch } } });
  },
  speakEnd: (playerId) => {
    const cur = get().speech[playerId];
    // 结束时留 250 毫秒让嘴巴自然合上
    if (cur) set({ speech: { ...get().speech, [playerId]: { ...cur, phase: 'finished', until: Math.min(cur.until, performance.now() + 250) } } });
  },
  announce: null,
  shout: (text, kind) => set({ announce: { id: fid++, text, kind, start: performance.now() } }),
  shake: { amp: 0, start: 0 },
  light: { level: 0, start: 0, duration: 0 },
  setMood: (playerId, emoji, face, ms = 2600) => {
    const now = performance.now();
    set({ moods: { ...get().moods, [playerId]: { emoji, face, start: now, until: now + ms } } });
  },
  doShake: (amp) => set({ shake: { amp, start: performance.now() } }),
  tension: 0,
  setTension: (v) => {
    if (Math.abs(v - get().tension) > 0.02) set({ tension: v });
  },
  boostLight: (level, ms) => set({ light: { level, start: performance.now(), duration: ms } }),
  play: (playerId, name) => {
    set({ anims: { ...get().anims, [playerId]: { name, start: performance.now() / 1000 } } });
  },
  flyChips: ({ delay = 0, ...f }) => {
    if (f.amount <= 0) return;
    const flight: ChipFlight = { ...f, id: fid++, start: performance.now() + delay };
    set({ flights: [...get().flights, flight].slice(-40) });
  },
  bubble: (playerId, text, kind, extra) => {
    const b: Bubble = {
      id: fid++,
      playerId,
      text,
      kind,
      until: Date.now() + (extra?.ms ?? (kind === 'emote' ? 2600 : 4200)),
      ...(extra?.speaker ? { speaker: extra.speaker } : {}),
    };
    set({ bubbles: [...get().bubbles.filter((x) => x.playerId !== playerId), b] });
  },
  setCue: (c) => set({ cue: c ? { ...c, start: performance.now() } : null }),
  burst: (position, kind) => set({ bursts: [...get().bursts, { id: fid++, position, kind, start: performance.now() }].slice(-12) }),
  setCool: (playerId, ms) => set({ coolUntil: { ...get().coolUntil, [playerId]: Date.now() + ms } }),
  shown: { hand: -1, seq: 0 },
  markShown: (hand, seq) => {
    const cur = get().shown;
    // 同一手牌只前进；换了一手（包括“再来一局”从第 1 手重新开始）直接切换
    if (hand !== cur.hand || seq > cur.seq) set({ shown: { hand, seq } });
  },
  presentation: null,
  present: (p) => set({ presentation: { ...p, id: fid++, start: performance.now() } }),
  cleanup: () => {
    const now = performance.now();
    const nowD = Date.now();
    const s = get();
    const flights = s.flights.filter((f) => now < f.start + f.duration + 800);
    const bubbles = s.bubbles.filter((b) => b.until > nowD);
    const bursts = s.bursts.filter((b) => now - b.start < 3500);
    const moodIds = Object.keys(s.moods);
    const liveMoods = moodIds.filter((k) => s.moods[k].until > now);
    const speechIds = Object.keys(s.speech);
    const liveSpeech = speechIds.filter((k) => s.speech[k].until > now);
    if (
      flights.length !== s.flights.length ||
      bubbles.length !== s.bubbles.length ||
      bursts.length !== s.bursts.length ||
      liveMoods.length !== moodIds.length ||
      liveSpeech.length !== speechIds.length
    ) {
      const moods: Record<string, Mood> = {};
      for (const k of liveMoods) moods[k] = s.moods[k];
      const speech: Record<string, SpeechState> = {};
      for (const k of liveSpeech) speech[k] = s.speech[k];
      set({ flights, bubbles, bursts, moods, speech });
    }
  },
  reset: () => set({ anims: {}, flights: [], bubbles: [], cue: null, bursts: [], coolUntil: {}, moods: {}, speech: {}, announce: null, presentation: null, shown: { hand: -1, seq: 0 }, tension: 0, shake: { amp: 0, start: 0 }, light: { level: 0, start: 0, duration: 0 } }),
}));

if (typeof window !== 'undefined') {
  setInterval(() => useFx.getState().cleanup(), 500);
}
