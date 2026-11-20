// 视觉效果状态：动物动画、筹码飞行、表情气泡、镜头提示、粒子
import { create } from 'zustand';

export type AnimName =
  | 'idle' | 'talk' | 'happy' | 'sad' | 'nervous' | 'angry' | 'surprised'
  | 'win' | 'lose' | 'bet' | 'raise' | 'fold' | 'allin' | 'think'
  | 'laugh' | 'shock' | 'cool' | 'fire' | 'dead' | 'clap' | 'love' | 'wave';

export const ANIM_DURATION: Record<AnimName, number> = {
  idle: 0, talk: 1.6, happy: 1.6, sad: 2.2, nervous: 2, angry: 1.8, surprised: 1.4,
  win: 3.6, lose: 3.2, bet: 1.1, raise: 1.4, fold: 1.5, allin: 2.6, think: 0,
  laugh: 2.2, shock: 1.8, cool: 3.5, fire: 2, dead: 2.4, clap: 2, love: 2.2, wave: 1.8,
};

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
  type: 'action' | 'allin' | 'showdown' | 'win';
  playerId?: string;
  start: number; // ms
  duration: number;
}

export interface Burst {
  id: number;
  position: [number, number, number];
  kind: 'confetti' | 'sparkle' | 'hearts' | 'fire';
  start: number;
}

interface FxState {
  anims: Record<string, AnimState>;
  flights: ChipFlight[];
  bubbles: Bubble[];
  cue: CameraCue | null;
  bursts: Burst[];
  coolUntil: Record<string, number>;
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
    const flights = s.flights.filter((f) => now < f.start + f.duration + 100);
    const bubbles = s.bubbles.filter((b) => b.until > nowD);
    const bursts = s.bursts.filter((b) => now - b.start < 3500);
    if (flights.length !== s.flights.length || bubbles.length !== s.bubbles.length || bursts.length !== s.bursts.length) {
      set({ flights, bubbles, bursts });
    }
  },
  reset: () => set({ anims: {}, flights: [], bubbles: [], cue: null, bursts: [], coolUntil: {} }),
}));

if (typeof window !== 'undefined') {
  setInterval(() => useFx.getState().cleanup(), 500);
}
