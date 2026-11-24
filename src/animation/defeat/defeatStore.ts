// 失败演出的状态（只属于“画面表现”）：不持有、不修改任何牌局 / 房间 / 玩家状态。
// 同一时间只有一段演出；同一手牌的同一个结果（handNumber + win 事件序号）只演一次。
// 阶段由 useDefeatDirector 按时间表推进；镜头、灯光、粒子在每一帧里按时间计算，不需要频繁更新这里。
import { create } from 'zustand';
import type { DefeatCut, DefeatPhase, DefeatProfile } from './defeatRules';

export interface DefeatSequence {
  /** 去重用：`${handNumber}:${win 事件序号}` */
  key: string;
  hand: number;
  cut: DefeatCut;
  loserId: string;
  winnerId: string | null;
  /** 每个阶段的开始时间（performance.now 毫秒） */
  at: Partial<Record<DefeatPhase, number>>;
  /** 其他动物开始转头看向输家的时间（performance.now 毫秒） */
  lookers: Record<string, number>;
  /** 冲击中心（输家座位，世界坐标 x / z） */
  origin: [number, number];
  /** 本手输掉的筹码 / 比例（简短版字幕用） */
  lost: number;
  ratio: number;
  profile: DefeatProfile;
  reduced: boolean;
}

export interface DefeatState {
  seq: DefeatSequence | null;
  phase: DefeatPhase | null;
  /** 玩家跳过了演出（只跳过画面，结果不变） */
  skipped: boolean;
  /** 已经演过的结果（只保留最近的一些） */
  played: string[];
}

export const useDefeat = create<DefeatState>()(() => ({ seq: null, phase: null, skipped: false, played: [] }));

/** 开始一段演出；同一个结果已经演过 / 正在演时返回 false（防止重复事件造成重复演出） */
export function beginDefeat(seq: DefeatSequence): boolean {
  const s = useDefeat.getState();
  if (s.played.includes(seq.key) || s.seq?.key === seq.key) return false;
  useDefeat.setState({ seq, phase: 'result', skipped: false, played: [...s.played, seq.key].slice(-24) });
  return true;
}

export function setDefeatPhase(key: string, phase: DefeatPhase) {
  const s = useDefeat.getState();
  if (s.seq?.key === key && s.phase !== phase) useDefeat.setState({ phase });
}

/** 结束（正常结束、跳过简短版、被打断）：清空演出状态；已演过的记录保留 */
export function endDefeat(key?: string) {
  const s = useDefeat.getState();
  if (!s.seq || (key && s.seq.key !== key)) return;
  useDefeat.setState({ seq: null, phase: null, skipped: false });
}

export function defeatActive(): boolean {
  return useDefeat.getState().seq !== null;
}

/** 正在被演出“倒下”的玩家（出局后也继续显示，直到演出结束） */
export function defeatLoserId(): string | null {
  return useDefeat.getState().seq?.loserId ?? null;
}

/** 测试用 */
export function resetDefeatForTest() {
  useDefeat.setState({ seq: null, phase: null, skipped: false, played: [] });
}

// ───────────── 冲击时桌面的视觉反应（只移动画面，不改变任何牌或筹码的真实状态） ─────────────

export interface Jolt {
  /** 抬起高度 */
  lift: number;
  /** 绕 X / Z 轴的倾斜 */
  rx: number;
  rz: number;
  /** 水平滑动 */
  dx: number;
  dz: number;
}
const ZERO: Jolt = { lift: 0, rx: 0, rz: 0, dx: 0, dz: 0 };

/**
 * 某个桌面物体（世界坐标 x / z）在此刻受到冲击的偏移：离冲击中心越近，被掀得越高、转得越多；
 * 先抬起翻转，再落下弹一下，最后滑回原位（约 1.6 秒后完全恢复）。
 * seed 让每张牌 / 每堆筹码的反应略有不同。
 */
export function tableJolt(x: number, z: number, now: number, seed = 0): Jolt {
  const s = useDefeat.getState().seq;
  const t0 = s?.at.impact;
  if (!s || t0 === undefined || now < t0) return ZERO;
  const t = (now - t0) / 1000;
  if (t > 1.8) return ZERO;
  const dx = x - s.origin[0];
  const dz = z - s.origin[1];
  const dist = Math.sqrt(dx * dx + dz * dz);
  const near = Math.max(0, 1 - dist / 4.2);
  if (near <= 0) return ZERO;
  const k = near * near * (s.reduced ? 0.35 : s.cut === 'short' ? 0.6 : 1);
  const r1 = Math.sin(seed * 12.9898) * 0.5 + 0.5;
  const r2 = Math.sin(seed * 78.233) * 0.5 + 0.5;
  // 抬起 → 落下（0.75 秒），落桌后小弹一下
  const fly = t < 0.75 ? Math.sin((t / 0.75) * Math.PI) : t < 1.05 ? Math.sin(((t - 0.75) / 0.3) * Math.PI) * 0.12 : 0;
  const lift = fly * (0.08 + r1 * 0.34) * k;
  const spin = (t < 0.75 ? Math.sin((t / 0.75) * Math.PI) : 0) * k * (near > 0.7 ? 2 : 1);
  // 向外滑开，再慢慢回到原位
  const slide = (t < 0.6 ? t / 0.6 : Math.max(0, 1 - (t - 0.6) / 1.2)) * 0.12 * k;
  const nx = dist > 0.001 ? dx / dist : 0;
  const nz = dist > 0.001 ? dz / dist : 0;
  return { lift, rx: spin * (r2 - 0.5) * 1.6, rz: spin * (r1 - 0.5) * 1.6, dx: nx * slide, dz: nz * slide };
}
