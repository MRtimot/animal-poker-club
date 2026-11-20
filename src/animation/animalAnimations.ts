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
  /** 耳朵抖动 / 竖起（0 = 静止） */
  ear: number;
  face: 'normal' | 'happy' | 'wide' | 'x' | 'sad' | 'angry' | 'smug' | 'doubt';
}

/** 物种的待机性格：节奏、摆动幅度与小习惯 */
interface IdleStyle {
  pace: number; // 呼吸 / 摆动速度
  sway: number; // 身体摇摆幅度
  tail: number; // 尾巴幅度
  glance: number; // 张望频率
  hop?: boolean; // 偶尔原地小跳（青蛙）
  earPerk?: boolean; // 耳朵偶尔竖起（兔子）
}
const IDLE: Record<string, IdleStyle> = {
  cat: { pace: 1, sway: 1, tail: 1.5, glance: 1.2 },
  fox: { pace: 1.05, sway: 1, tail: 1.4, glance: 1.5 },
  panda: { pace: 0.7, sway: 2.2, tail: 0.3, glance: 0.6 },
  bear: { pace: 0.75, sway: 1.8, tail: 0.3, glance: 0.7 },
  koala: { pace: 0.6, sway: 1.4, tail: 0.2, glance: 0.5 },
  frog: { pace: 1.1, sway: 0.6, tail: 0, glance: 0.9, hop: true },
  rabbit: { pace: 1.4, sway: 0.8, tail: 0.6, glance: 1.4, earPerk: true },
  dog: { pace: 1.2, sway: 1, tail: 2, glance: 1.2 },
  monkey: { pace: 1.3, sway: 1.3, tail: 1.3, glance: 1.8 },
};
const DEFAULT_IDLE: IdleStyle = { pace: 1, sway: 1, tail: 1, glance: 1 };

/** 周期性的小事件：每 period 秒发生一次，持续 len 秒，返回 0~1~0 的包络 */
function every(time: number, period: number, len: number, offset: number) {
  const ph = (time + offset) % period;
  if (ph > len) return 0;
  return Math.sin((ph / len) * Math.PI);
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function basePose(time: number, seed: number, seated: boolean, folded: boolean, thinking: boolean, species = ''): Pose {
  const s = seed * 7.13;
  const st = IDLE[species] ?? DEFAULT_IDLE;
  const breathe = Math.sin(time * 2 * st.pace + s) * 0.5 + 0.5;
  // 自然眨眼：每 ~3.7 秒一次
  const blinkPhase = (time + s) % 3.7;
  const blink = blinkPhase < 0.12 ? Math.abs(Math.cos((blinkPhase / 0.12) * Math.PI)) : 1;
  const restX = seated ? -1.05 : -0.12;
  const restZ = seated ? 0.12 : 0.18;
  const p: Pose = {
    y: 0,
    lean: seated ? 0.06 : 0,
    turn: 0,
    roll: Math.sin(time * 0.9 * st.pace + s) * 0.015 * st.sway,
    headX: Math.sin(time * 0.6 + s) * 0.04,
    headY: Math.sin(time * 0.45 * st.pace + s * 2) * 0.12,
    headZ: Math.sin(time * 0.7 + s) * 0.04,
    armLX: restX + Math.sin(time * 1.3 + s) * 0.03,
    armLZ: restZ,
    armRX: restX + Math.sin(time * 1.1 + s + 1) * 0.03,
    armRZ: -restZ,
    mouth: 0,
    eyeOpen: blink,
    tail: Math.sin(time * 2.2 * st.pace + s) * 0.35 * st.tail,
    squash: 1 + breathe * 0.025,
    wing: Math.sin(time * 3 + s) * 0.15,
    ear: 0,
    face: 'normal',
  };

  // —— 微动画：让角色“活着”，但不过度 ——
  // 偶尔看向旁边的玩家
  const glancePeriod = 7.5 / st.glance;
  const gl = every(time, glancePeriod, 1.6, s);
  const glDir = Math.sin(Math.floor((time + s) / glancePeriod) * 12.9898) > 0 ? 1 : -1;
  p.headY += gl * 0.42 * glDir;
  p.headX -= gl * 0.04;
  // 耳朵抖一下
  p.ear = every(time, 4.3 + (seed % 3) * 0.7, 0.28, s * 1.7) * (Math.sin(time * 60) * 0.5 + 0.5);
  if (st.earPerk) p.ear = Math.max(p.ear, every(time, 6.1, 1.2, s) * 1.2);
  // 青蛙：偶尔原地小跳（先压缩再跳）
  if (st.hop) {
    const ph = (time + s) % 5.2;
    if (ph < 0.18) p.squash -= Math.sin((ph / 0.18) * Math.PI) * 0.08;
    else if (ph < 0.5) p.y += Math.sin(((ph - 0.18) / 0.32) * Math.PI) * 0.09;
  }
  // 偶尔打哈欠 / 伸懒腰（不在思考或弃牌时）
  if (!thinking && !folded) {
    const y = every(time, 21 + (seed % 4) * 3, 1.8, s * 3.1);
    if (y > 0) {
      p.mouth = Math.max(p.mouth, y * 0.95);
      p.headX -= y * 0.28;
      p.eyeOpen = Math.min(p.eyeOpen, 1 - y * 0.8);
      p.armLZ += y * 0.4;
      p.armRZ -= y * 0.4;
    }
  }
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
    case 'stretch': {
      // 入座后伸懒腰
      const k = Math.sin(clamp01(p / 0.8) * Math.PI);
      o.armLX = o.armRX = lerp(restX, -2.9, k);
      o.armLZ = 0.35 * k;
      o.armRZ = -0.35 * k;
      o.lean = -0.15 * k;
      o.headX = -0.3 * k;
      o.mouth = 0.8 * k;
      o.eyeOpen = 1 - 0.85 * k;
      o.squash = 1 + 0.06 * k;
      break;
    }
    case 'settle': {
      // 坐下后整理衣服：左右扯一扯、拍一拍
      o.armLX = o.armRX = restX + 0.55;
      o.armLZ = -0.25 + Math.sin(t * 14) * 0.12;
      o.armRZ = 0.25 - Math.sin(t * 14) * 0.12;
      o.headX = 0.28;
      o.roll = Math.sin(t * 7) * 0.04;
      break;
    }
    case 'doubt': {
      // 怀疑：歪头、眯眼、托下巴
      o.headZ = 0.22;
      o.headY = base.headY * 0.3 + 0.15;
      o.armRX = -2.0;
      o.armRZ = 0.4;
      o.lean = -0.05;
      o.eyeOpen = 0.75;
      o.face = 'doubt';
      break;
    }
    case 'smug': {
      // 自信：往后靠、抱臂、微笑
      o.lean = -0.14;
      o.headX = -0.12;
      o.armLX = o.armRX = -1.2;
      o.armLZ = -0.6;
      o.armRZ = 0.6;
      o.tail = Math.sin(t * 6) * 0.5;
      o.face = 'smug';
      break;
    }
    case 'peek': {
      // 看底牌：低头、双手捂牌、偷偷抬起一角
      const k = Math.sin(clamp01(p) * Math.PI);
      o.headX = 0.45 * k;
      o.lean = base.lean + 0.15 * k;
      o.armLX = o.armRX = restX - 0.25 * k;
      o.armLZ = -0.15 * k;
      o.armRZ = 0.15 * k;
      break;
    }
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
