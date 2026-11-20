// 统一动画系统：所有 3D / UI 动画共用的时长、缓动、弹簧与阻尼工具
// 不同类型的动画使用不同的节奏：按钮最快，镜头和胜利演出最慢

/** 时长（毫秒） */
export const DUR = {
  button: 140,
  ui: 220,
  number: 600,
  cardFlight: 540,
  cardFlip: 440,
  cardMove: 480,
  cardRetire: 420,
  chipFlight: 620,
  chipSettle: 220,
  character: 700,
  entrance: 1300,
  camera: 1100,
  win: 1600,
  intro: 2400,
} as const;

/** 依次出现的间隔（毫秒） */
export const STAGGER = {
  holeCard: 150,
  flop: [0, 380, 760] as const,
  chipColumn: 55,
  chipCollect: 70,
  winnerPayout: 260,
  seatEntrance: 260,
  retireCard: 45,
} as const;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 缓动函数（输入输出都在 0~1） */
export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  smooth: (t: number) => t * t * (3 - 2 * t),
  /** 轻微超出再回来 */
  outBack: (t: number, s = 1.6) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outElastic: (t: number) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

/** 进度（毫秒时间轴）：返回 0~1，未开始为 0 */
export const progress = (now: number, start: number, duration: number) => clamp01((now - start) / duration);

/** 与帧率无关的指数阻尼：lambda 越大越快 */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** 衰减振荡：用于落地后的“压一下→弹回→稳定” */
export function settle(t: number, amp: number, freq = 26, decay = 11) {
  if (t < 0) return 0;
  return -amp * Math.exp(-decay * t) * Math.cos(freq * t);
}

/** 抛物线高度：0→h→0 */
export const arc = (t: number, h: number) => Math.sin(clamp01(t) * Math.PI) * h;

/** 临界阻尼弹簧（单值） */
export class Spring {
  value: number;
  vel = 0;
  constructor(v = 0) {
    this.value = v;
  }
  step(target: number, dt: number, stiffness = 170, damping = 18) {
    const d = Math.min(dt, 1 / 30);
    const f = -stiffness * (this.value - target) - damping * this.vel;
    this.vel += f * d;
    this.value += this.vel * d;
    return this.value;
  }
  kick(v: number) {
    this.vel += v;
  }
}

/** 与 CSS 共用的缓动曲线 */
export const CSS_EASE = {
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  back: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
};
