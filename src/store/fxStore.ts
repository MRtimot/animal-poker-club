// 视觉效果状态：动物动画、筹码飞行、表情气泡、镜头提示、粒子
import { create } from 'zustand';

export type AnimName =
  | 'idle' | 'talk' | 'happy' | 'sad' | 'nervous' | 'angry' | 'surprised'
  | 'win' | 'lose' | 'bet' | 'raise' | 'fold' | 'allin' | 'think'
  | 'laugh' | 'shock' | 'cool' | 'fire' | 'dead' | 'clap' | 'love' | 'wave'
  | 'stretch' | 'settle' | 'doubt' | 'smug' | 'peek';

export const ANIM_DURATION: Record<AnimName, number> = {
  idle: 0, talk: 1.6, happy: 1.6, sad: 2.2, nervous: 2, angry: 1.8, surprised: 1.4,
  win: 3.6, lose: 3.2, bet: 1.1, raise: 1.4, fold: 1.5, allin: 2.6, think: 0,
  laugh: 2.2, shock: 1.8, cool: 3.5, fire: 2, dead: 2.4, clap: 2, love: 2.2, wave: 1.8,
  stretch: 2.2, settle: 1.2, doubt: 1.8, smug: 2, peek: 1.6,
};

/** 表情（情绪系统）：会改变动物脸部，并在头顶短暂显示 */
export type MoodFace = 'normal' | 'happy' | 'wide' | 'sad' | 'angry' | 'smug' | 'doubt' | 'x';
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
}

export interface Bubble {
  id: number;
  playerId: string;
  text: string;
  kind: 'chat' | 'emote';
  until: number;
}

export interface CameraCue {
  type: 'action' | 'allin' | 'showdown' | 'win' | 'flop' | 'turn' | 'river' | 'intro';
  playerId?: string;
  start: number; // ms
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
  /** 镜头震动 */
  shake: { amp: number; start: number };
  /** 桌面灯光增强（0~1） */
  light: { level: number; start: number; duration: number };
  /** 屏幕中央的大字提示（全押！/ 翻牌 / 转牌 / 河牌 / 平局！） */
  announce: { id: number; text: string; kind: 'allin' | 'street' | 'tie' | 'end'; start: number } | null;
  shout: (text: string, kind: 'allin' | 'street' | 'tie' | 'end') => void;
  setMood: (playerId: string, emoji: string, face: MoodFace, ms?: number) => void;
  doShake: (amp: number) => void;
  boostLight: (level: number, ms: number) => void;
  play: (playerId: string, name: AnimName) => void;
  flyChips: (f: Omit<ChipFlight, 'id' | 'start'> & { delay?: number }) => void;
  bubble: (playerId: string, text: string, kind: Bubble['kind']) => void;
  setCue: (c: Omit<CameraCue, 'start'> | null) => void;
  burst: (position: [number, number, number], kind: Burst['kind']) => void;
  setCool: (playerId: string, ms: number) => void;
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
  announce: null,
  shout: (text, kind) => set({ announce: { id: fid++, text, kind, start: performance.now() } }),
  shake: { amp: 0, start: 0 },
  light: { level: 0, start: 0, duration: 0 },
  setMood: (playerId, emoji, face, ms = 2600) => {
    const now = performance.now();
    set({ moods: { ...get().moods, [playerId]: { emoji, face, start: now, until: now + ms } } });
  },
  doShake: (amp) => set({ shake: { amp, start: performance.now() } }),
  boostLight: (level, ms) => set({ light: { level, start: performance.now(), duration: ms } }),
  play: (playerId, name) => {
    set({ anims: { ...get().anims, [playerId]: { name, start: performance.now() / 1000 } } });
  },
  flyChips: ({ delay = 0, ...f }) => {
    if (f.amount <= 0) return;
    const flight: ChipFlight = { ...f, id: fid++, start: performance.now() + delay };
    set({ flights: [...get().flights, flight].slice(-40) });
  },
  bubble: (playerId, text, kind) => {
    const b: Bubble = { id: fid++, playerId, text, kind, until: Date.now() + (kind === 'emote' ? 2600 : 4200) };
    set({ bubbles: [...get().bubbles.filter((x) => x.playerId !== playerId), b] });
  },
  setCue: (c) => set({ cue: c ? { ...c, start: performance.now() } : null }),
  burst: (position, kind) => set({ bursts: [...get().bursts, { id: fid++, position, kind, start: performance.now() }].slice(-12) }),
  setCool: (playerId, ms) => set({ coolUntil: { ...get().coolUntil, [playerId]: Date.now() + ms } }),
  cleanup: () => {
    const now = performance.now();
    const nowD = Date.now();
    const s = get();
    const flights = s.flights.filter((f) => now < f.start + f.duration + 800);
    const bubbles = s.bubbles.filter((b) => b.until > nowD);
    const bursts = s.bursts.filter((b) => now - b.start < 3500);
    const moodIds = Object.keys(s.moods);
    const liveMoods = moodIds.filter((k) => s.moods[k].until > now);
    if (flights.length !== s.flights.length || bubbles.length !== s.bubbles.length || bursts.length !== s.bursts.length || liveMoods.length !== moodIds.length) {
      const moods: Record<string, Mood> = {};
      for (const k of liveMoods) moods[k] = s.moods[k];
      set({ flights, bubbles, bursts, moods });
    }
  },
  reset: () => set({ anims: {}, flights: [], bubbles: [], cue: null, bursts: [], coolUntil: {}, moods: {}, announce: null, shake: { amp: 0, start: 0 }, light: { level: 0, start: 0, duration: 0 } }),
}));

if (typeof window !== 'undefined') {
  setInterval(() => useFx.getState().cleanup(), 500);
}
