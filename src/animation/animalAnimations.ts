// 动物程序化动画：根据动画名称与时间计算骨骼姿态（与渲染无关的纯数学）
import { ANIM_DURATION, AnimName } from '../store/fxStore';

export interface Pose {
  y: number; // 身体整体抬升
  lean: number; // 前后倾（+ 向前）
  turn: number; // 绕 Y 轴旋转
  roll: number; // 左右摇摆
  headX: number; // + 低头
  headY: number;
  headZ: number;
  armLX: number;
  armLZ: number;
  armRX: number;
  armRZ: number;
  mouth: number; // 0 闭 ~ 1 大张
  eyeOpen: number; // 1 正常，>1 瞪大，0 闭
  tail: number; // 尾巴摆动
  squash: number; // 身体压缩（1 = 正常）
  wing: number;
  face: 'normal' | 'happy' | 'wide' | 'x' | 'sad' | 'angry';
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function basePose(time: number, seed: number, seated: boolean, folded: boolean, thinking: boolean): Pose {
  const s = seed * 7.13;
  const breathe = Math.sin(time * 2 + s) * 0.5 + 0.5;
  // 自然眨眼：每 ~3.7 秒一次
  const blinkPhase = (time + s) % 3.7;
  const blink = blinkPhase < 0.12 ? Math.abs(Math.cos((blinkPhase / 0.12) * Math.PI)) : 1;
  const restX = seated ? -1.05 : -0.12;
  const restZ = seated ? 0.12 : 0.18;
  const p: Pose = {
    y: 0,
    lean: seated ? 0.06 : 0,
    turn: 0,
    roll: Math.sin(time * 0.9 + s) * 0.015,
    headX: Math.sin(time * 0.6 + s) * 0.04,
    headY: Math.sin(time * 0.45 + s * 2) * 0.12,
    headZ: Math.sin(time * 0.7 + s) * 0.04,
    armLX: restX + Math.sin(time * 1.3 + s) * 0.03,
    armLZ: restZ,
    armRX: restX + Math.sin(time * 1.1 + s + 1) * 0.03,
    armRZ: -restZ,
    mouth: 0,
    eyeOpen: blink,
    tail: Math.sin(time * 2.2 + s) * 0.35,
    squash: 1 + breathe * 0.025,
    wing: Math.sin(time * 3 + s) * 0.15,
    face: 'normal',
  };
  if (folded) {
    p.lean = -0.08;
    p.headX = 0.18 + Math.sin(time * 0.5) * 0.03;
    p.armLX = seated ? -0.55 : -0.05;
    p.armRX = seated ? -0.55 : -0.05;
    p.face = 'sad';
  }
  if (thinking && !folded) {
    // 托腮思考
    p.armRX = -2.15 + Math.sin(time * 1.5) * 0.04;
    p.armRZ = 0.45;
    p.headZ = 0.12;
    p.headX = 0.05;
    p.headY = Math.sin(time * 0.8) * 0.18;
  }
  return p;
}

/** 在基础姿态上叠加一次性动画 */
export function animatePose(base: Pose, name: AnimName, t: number, seated: boolean): Pose {
  const d = ANIM_DURATION[name] || 0;
  if (!d || t < 0 || t > d) return base;
  const p = t / d;
  // 进入 / 退出混合
  const w = smooth(t / 0.18) * smooth((d - t) / 0.3);
  const o: Pose = { ...base };
  const restX = seated ? -1.05 : -0.12;

  switch (name) {
    case 'talk':
      o.mouth = Math.abs(Math.sin(t * 13)) * 0.7;
      o.headX = base.headX + Math.sin(t * 6) * 0.08;
      o.armRX = restX - 0.35 - Math.sin(t * 5) * 0.2;
      break;
    case 'happy':
      o.y = Math.abs(Math.sin(t * 8)) * 0.12;
      o.armLZ = 0.9 + Math.sin(t * 10) * 0.2;
      o.armRZ = -0.9 - Math.sin(t * 10) * 0.2;
      o.armLX = o.armRX = -0.6;
      o.mouth = 0.6;
      o.face = 'happy';
      break;
    case 'sad':
      o.headX = 0.45;
      o.lean = 0.05;
      o.squash = 0.95;
      o.armLX = o.armRX = seated ? -0.5 : 0;
      o.tail = 0;
      o.face = 'sad';
      break;
    case 'nervous':
      o.roll = Math.sin(t * 40) * 0.03;
      o.headY = Math.sin(t * 3.2) * 0.45;
      o.eyeOpen = 1.25;
      o.armLX = o.armRX = restX - 0.4;
      o.armLZ = -0.2;
      o.armRZ = 0.2;
      o.face = 'wide';
      break;
    case 'angry':
      o.lean = 0.2;
      o.headX = 0.1;
      o.armLX = restX - 0.5 - Math.max(0, Math.sin(t * 12)) * 0.5;
      o.armRX = restX - 0.5 - Math.max(0, Math.sin(t * 12 + Math.PI)) * 0.5;
      o.y = Math.max(0, Math.sin(t * 12)) * 0.03;
      o.mouth = 0.3;
      o.face = 'angry';
      break;
    case 'surprised':
    case 'shock': {
      const jump = p < 0.35 ? Math.sin((p / 0.35) * Math.PI) * (name === 'shock' ? 0.35 : 0.22) : 0;
      o.y = jump;
      o.lean = -0.25;
      o.headX = -0.2;
      o.armLZ = 1.3;
      o.armRZ = -1.3;
      o.armLX = o.armRX = -1.2;
      o.mouth = 1;
      o.eyeOpen = 1.45;
      o.face = 'wide';
      if (name === 'shock') o.roll = Math.sin(t * 35) * 0.04 * (1 - p);
      break;
    }
    case 'win': {
      o.y = Math.abs(Math.sin(t * 6)) * 0.38 + (seated ? 0.25 : 0);
      o.turn = p < 0.3 ? smooth(p / 0.3) * Math.PI * 2 : 0;
      o.armLX = o.armRX = -2.9;
      o.armLZ = 0.45 + Math.sin(t * 9) * 0.25;
      o.armRZ = -0.45 - Math.sin(t * 9) * 0.25;
      o.mouth = 0.85;
      o.headX = -0.2;
      o.tail = Math.sin(t * 18) * 0.7;
      o.wing = Math.sin(t * 16) * 0.6;
      o.face = 'happy';
      break;
    }
    case 'lose': {
      if (p < 0.25) {
        o.lean = -0.25;
        o.armLZ = 1.0;
        o.armRZ = -1.0;
        o.armLX = o.armRX = -1.5;
        o.mouth = 1;
        o.eyeOpen = 1.4;
        o.face = 'wide';
        o.y = Math.sin((p / 0.25) * Math.PI) * 0.12;
      } else {
        const k = smooth((p - 0.25) / 0.2);
        o.headX = lerp(0, 0.55, k);
        o.lean = lerp(-0.25, 0.1, k);
        o.squash = lerp(1, 0.92, k);
        o.armLX = o.armRX = seated ? -0.45 : 0.05;
        o.headY = Math.sin(t * 2.5) * 0.15 * k; // 无奈地摇头
        o.tail = 0;
        o.face = 'sad';
      }
      break;
    }
    case 'bet': {
      const push = Math.sin(clamp01(p / 0.7) * Math.PI);
      o.armRX = restX - 0.15 - push * 0.55;
      o.armRZ = -0.05;
      o.lean = base.lean + push * 0.12;
      o.headX = 0.12 * push;
      break;
    }
    case 'raise': {
      const push = Math.sin(clamp01(p / 0.75) * Math.PI);
      o.armLX = o.armRX = restX - 0.25 - push * 0.7;
      o.armLZ = 0.02;
      o.armRZ = -0.02;
      o.lean = base.lean + push * 0.2;
      o.headX = -0.08 * push;
      o.mouth = 0.25 * push;
      break;
    }
    case 'fold': {
      const k = smooth(p / 0.3);
      o.armLX = o.armRX = lerp(restX - 0.3, seated ? -0.5 : 0, k);
      o.headY = Math.sin(t * 11) * 0.35 * (1 - p);
      o.lean = -0.1 * k;
      o.headX = 0.15;
      o.face = 'sad';
      break;
    }
    case 'allin': {
      const rise = smooth(p / 0.18);
      o.y = rise * (seated ? 0.42 : 0.15);
      o.lean = -0.12 * rise;
      o.headX = -0.18;
      if (p < 0.4) {
        const push = Math.sin(clamp01(p / 0.4) * Math.PI);
        o.armLX = o.armRX = -1.2 - push * 0.6;
      } else {
        o.armLX = o.armRX = -1.4;
        o.armLZ = 1.35;
        o.armRZ = -1.35;
      }
      o.mouth = 0.5;
      o.tail = Math.sin(t * 12) * 0.6;
      o.face = 'angry';
      break;
    }
    case 'laugh':
      o.y = Math.abs(Math.sin(t * 18)) * 0.05;
      o.headX = -0.3 + Math.sin(t * 18) * 0.05;
      o.mouth = 0.7 + Math.sin(t * 18) * 0.3;
      o.armLX = o.armRX = -0.9;
      o.armLZ = -0.35;
      o.armRZ = 0.35;
      o.face = 'happy';
      break;
    case 'cool':
      o.lean = -0.12;
      o.headX = -0.1 + Math.sin(t * 3) * 0.05;
      o.armLX = o.armRX = -1.25;
      o.armLZ = -0.65;
      o.armRZ = 0.65;
      o.mouth = 0.1;
      break;
    case 'fire':
      o.y = Math.abs(Math.sin(t * 7)) * 0.08;
      o.armLZ = 1.5 + Math.sin(t * 9) * 0.2;
      o.armRZ = -1.5 - Math.sin(t * 9) * 0.2;
      o.armLX = o.armRX = -0.3;
      o.mouth = 0.5;
      o.face = 'angry';
      break;
    case 'dead':
      o.lean = -0.45;
      o.headZ = 0.4;
      o.headX = -0.2;
      o.armLZ = 0.9;
      o.armRZ = -0.9;
      o.armLX = o.armRX = -0.2;
      o.eyeOpen = 0;
      o.mouth = 0.4;
      o.face = 'x';
      break;
    case 'clap':
      o.armLX = o.armRX = -1.45;
      o.armLZ = -0.3 + Math.abs(Math.sin(t * 14)) * 0.45;
      o.armRZ = 0.3 - Math.abs(Math.sin(t * 14)) * 0.45;
      o.mouth = 0.5;
      o.face = 'happy';
      break;
    case 'love':
      o.roll = Math.sin(t * 4) * 0.12;
      o.headZ = Math.sin(t * 4) * 0.15;
      o.armLX = o.armRX = -1.3;
      o.armLZ = -0.45;
      o.armRZ = 0.45;
      o.face = 'happy';
      o.mouth = 0.3;
      break;
    case 'wave':
      o.armRX = -2.6;
      o.armRZ = -0.5 + Math.sin(t * 10) * 0.35;
      o.mouth = 0.4;
      o.face = 'happy';
      break;
    default:
      return base;
  }

  // 与基础姿态混合
  const mix = (k: keyof Pose) => {
    if (k === 'face') return;
    (o as any)[k] = lerp(base[k] as number, o[k] as number, w);
  };
  (Object.keys(o) as (keyof Pose)[]).forEach(mix);
  if (w < 0.5) o.face = base.face;
  return o;
}

export const EMOTE_ANIM: Record<string, AnimName> = {
  '😂': 'laugh',
  '😱': 'shock',
  '😎': 'cool',
  '🔥': 'fire',
  '💀': 'dead',
  '👏': 'clap',
  '❤️': 'love',
  '🤣': 'laugh',
};
