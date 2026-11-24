// 出局处决：头部掉落的轨迹 + 动物头部的登记表。
// · 轨迹是纯函数：斩首那一刻按起点 / 初速度 / 旋转一次性算好（固定步长、最多 3.2 秒，不可能“物理失控”），
//   之后每一帧只是查表插值——不引入任何物理引擎，也不会碰到牌桌、牌、筹码或其他玩家。
// · 落地 / 弹跳的时刻也记录下来，声音与画面完全同步。
// · 风格化：只有“头离开身体 → 飞起 → 旋转 → 落地 → 弹一下 → 滚动 → 停住”，没有任何伤口或身体内部。
import type { Object3D } from 'three';

export type Vec3 = [number, number, number];
/** 四元数 [x, y, z, w] */
export type Quat = [number, number, number, number];

export interface HeadFallInput {
  /** 头部中心的起点（世界坐标） */
  start: Vec3;
  /** 初速度（米 / 秒） */
  vel: Vec3;
  /** 角速度（弧度 / 秒，世界坐标轴） */
  spin: Vec3;
  /** 头部的近似半径（用来判断落地） */
  radius: number;
  /** 地面高度 */
  floorY: number;
  /** 最长模拟时间（秒） */
  maxT?: number;
  dt?: number;
}

export interface HeadFallSample {
  t: number;
  p: Vec3;
  /** 相对起始朝向的旋转（世界坐标系中先乘在起始朝向上） */
  q: Quat;
}

export interface HeadFall {
  samples: HeadFallSample[];
  /** 每次撞到地面：时刻（秒）与撞击速度（米 / 秒） */
  contacts: { t: number; speed: number }[];
  /** 完全停住的时刻（秒） */
  restAt: number;
}

export const HEAD_GRAVITY = -9.8;
/** 弹跳的恢复系数（越小越“重”） */
const RESTITUTION = 0.32;
/** 低于这个速度就不再弹起，开始在地上滚动 */
const MIN_BOUNCE = 0.6;

function qMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qNorm(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/** 按世界坐标角速度 w 旋转 dt 秒：q' = Δq(w·dt) · q */
function qIntegrate(q: Quat, w: Vec3, dt: number): Quat {
  const ang = Math.hypot(w[0], w[1], w[2]) * dt;
  if (ang < 1e-9) return q;
  const s = Math.sin(ang / 2) / (ang / dt);
  const d: Quat = [w[0] * s, w[1] * s, w[2] * s, Math.cos(ang / 2)];
  return qNorm(qMul(d, q));
}

/** 计算头部掉落的完整轨迹（固定步长 1/120 秒） */
export function simulateHeadFall(o: HeadFallInput): HeadFall {
  const dt = o.dt ?? 1 / 120;
  const maxT = o.maxT ?? 3.2;
  const r = Math.max(0.05, o.radius);
  const floor = o.floorY + r;
  const p: Vec3 = [...o.start];
  const v: Vec3 = [...o.vel];
  let w: Vec3 = [...o.spin];
  let q: Quat = [0, 0, 0, 1];
  let grounded = false;
  const samples: HeadFallSample[] = [{ t: 0, p: [...p], q }];
  const contacts: { t: number; speed: number }[] = [];
  let restAt = maxT;
  const steps = Math.ceil(maxT / dt);
  for (let i = 1; i <= steps; i++) {
    const t = i * dt;
    if (!grounded) {
      v[1] += HEAD_GRAVITY * dt;
      p[0] += v[0] * dt;
      p[1] += v[1] * dt;
      p[2] += v[2] * dt;
      if (p[1] <= floor) {
        p[1] = floor;
        const impact = -v[1];
        if (impact > 0.05) contacts.push({ t, speed: impact });
        if (impact > MIN_BOUNCE) {
          // 弹起：竖直速度损失大部分，水平速度与旋转被地面“吃掉”一部分
          v[1] = impact * RESTITUTION;
          v[0] *= 0.72;
          v[2] *= 0.72;
          w = [w[0] * 0.6, w[1] * 0.6, w[2] * 0.6];
        } else {
          v[1] = 0;
          grounded = true;
        }
      }
    } else {
      // 在地上：摩擦让它慢下来，旋转逐渐变成“滚动”（角速度与移动方向一致）
      const f = Math.max(0, 1 - 3.2 * dt);
      v[0] *= f;
      v[2] *= f;
      p[0] += v[0] * dt;
      p[2] += v[2] * dt;
      const roll: Vec3 = [v[2] / r, 0, -v[0] / r];
      const k = Math.min(1, 10 * dt);
      w = [w[0] + (roll[0] - w[0]) * k, w[1] * (1 - k), w[2] + (roll[2] - w[2]) * k];
      if (Math.hypot(v[0], v[2]) < 0.03 && Math.hypot(w[0], w[1], w[2]) < 0.15) {
        q = qIntegrate(q, w, dt);
        samples.push({ t, p: [...p], q });
        restAt = t;
        break;
      }
    }
    q = qIntegrate(q, w, dt);
    samples.push({ t, p: [...p], q });
  }
  return { samples, contacts, restAt };
}

/** 某一时刻的位置与旋转（样本之间线性插值；超出范围时停在最后一个样本） */
export function sampleHeadFall(fall: HeadFall, t: number): { p: Vec3; q: Quat } {
  const s = fall.samples;
  if (t <= 0 || s.length < 2) return { p: [...s[0].p], q: [...s[0].q] };
  const last = s[s.length - 1];
  if (t >= last.t) return { p: [...last.p], q: [...last.q] };
  const step = s[1].t - s[0].t;
  const i = Math.min(s.length - 2, Math.floor(t / step));
  const a = s[i];
  const b = s[i + 1];
  const k = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t || 1)));
  const p: Vec3 = [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k];
  // 四元数：取短路径后线性插值再归一化（相邻样本只差一小步，误差可以忽略）
  const dot = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3];
  const sg = dot < 0 ? -1 : 1;
  const q = qNorm([
    a.q[0] + (b.q[0] * sg - a.q[0]) * k,
    a.q[1] + (b.q[1] * sg - a.q[1]) * k,
    a.q[2] + (b.q[2] * sg - a.q[2]) * k,
    a.q[3] + (b.q[3] * sg - a.q[3]) * k,
  ]);
  return { p, q };
}

/**
 * 斩首时的初速度与旋转：头部向侧面（side）飞出、略微向外、先向上抛起，翻滚着落到椅子旁边的地面上。
 * dir：座位朝外的水平方向（单位向量）；side：与它垂直的水平方向（镜头所在的一侧）；rand 让每次略有不同。
 */
export function headLaunch(dir: [number, number], side: [number, number], rand: () => number = Math.random): { vel: Vec3; spin: Vec3 } {
  const s = 1.05 + rand() * 0.25;
  const out = 0.3 + rand() * 0.2;
  const vel: Vec3 = [side[0] * s + dir[0] * out, 1.6 + rand() * 0.3, side[1] * s + dir[1] * out];
  // 绕“前进方向的水平垂线”翻滚，再加一点随机的侧旋
  const hx = vel[0];
  const hz = vel[2];
  const hl = Math.hypot(hx, hz) || 1;
  const spinMag = 6 + rand() * 3;
  const spin: Vec3 = [(hz / hl) * spinMag, (rand() - 0.5) * 3, (-hx / hl) * spinMag];
  return { vel, spin };
}

// ───────────── 动物头部的登记表（AnimalModel 挂载时登记，卸载时移除） ─────────────

const heads = new Map<string, Object3D>();

export function registerHead(id: string, obj: Object3D) {
  heads.set(id, obj);
}
export function unregisterHead(id: string, obj: Object3D) {
  if (heads.get(id) === obj) heads.delete(id);
}
export function getHead(id: string): Object3D | undefined {
  return heads.get(id);
}
