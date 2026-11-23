// 启动进度（电脑版加载页使用）
// 只记录真实完成的启动步骤：每一步都对应一个可以观测到的事件，不按时间猜进度、不用计时器“推进”百分比。
// 本游戏没有需要下载的模型、贴图、音频或网页字体（3D 场景全部由代码生成），
// 所以启动的真实工作是：下载并运行页面代码 → 创建 3D 画布 → 搭建场景 → 编译着色器 → 渲染出第一批画面。
// 多人服务器、账号、存档、Cookie 都不在这里：它们不能阻塞进入首页。
import { create } from 'zustand';

export type BootStep = 'core' | 'gl' | 'scene' | 'shaders' | 'frames';

/**
 * 启动步骤、在进度中的权重与显示的文字。
 * 进度 = 已经完成的步骤权重之和，只在一个步骤真正完成时增加。
 * 权重按生产版本的实测耗时比例（电脑、各画质、缓存后）：创建 3D 画布（含首页第一次渲染）约占 40%，
 * 其余步骤各约 10%~20%。第一次打开时页面代码的下载在 React 启动之前，由 index.html 的启动画面显示（不显示百分比）。
 */
export const BOOT_STEPS: { id: BootStep; weight: number; label: string }[] = [
  // 页面代码已下载并运行，存档与设置已读取，界面字体就绪
  { id: 'core', weight: 15, label: '正在打开俱乐部' },
  // 3D 画布（WebGL）已创建
  { id: 'gl', weight: 40, label: '正在布置牌桌' },
  // 首页 3D 场景（牌桌、动物、灯光与环境反射）已经搭建；高画质时包括后期处理模块的下载
  { id: 'scene', weight: 15, label: '动物们正在入座' },
  // 场景里所有材质的着色器已编译完成（包括还没入座的动物），进入首页后不会再卡顿
  { id: 'shaders', weight: 15, label: '正在点亮灯光' },
  // 已经渲染出最初几帧画面（阴影与后期处理也在第一帧时准备好）
  { id: 'frames', weight: 15, label: '正在进入牌桌' },
];
export const READY_LABEL = '欢迎来到俱乐部';
export const DEGRADED_LABEL = '3D 画面暂时无法显示，正在以简化模式进入';

/** 多久没有任何步骤完成（且页面在前台）就认为卡住了：显示原因与重试 */
export const STALL_MS = 20_000;

const NONE: Record<BootStep, boolean> = { core: false, gl: false, scene: false, shaders: false, frames: false };

export interface BootState {
  done: Record<BootStep, boolean>;
  /** 3D 无法使用（WebGL 不可用 / 场景出错）：不阻塞进入首页，首页会显示静态背景与提示 */
  degraded: boolean;
  /** 长时间没有任何进展 */
  stalled: boolean;
  /** 重新准备 3D 的次数（App 据此重建画布） */
  attempt: number;
  /** 最近一次有步骤完成的时间（用于判断是否卡住） */
  lastProgressAt: number;
}

export const useBoot = create<BootState>()(() => ({ done: { ...NONE }, degraded: false, stalled: false, attempt: 0, lastProgressAt: now() }));

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 某个启动步骤真正完成（重复调用无影响） */
export function markBoot(step: BootStep) {
  const s = useBoot.getState();
  if (s.done[step]) return;
  try {
    performance.mark?.(`apc-boot:${step}`);
  } catch {
    /* 性能标记只用于测量 */
  }
  useBoot.setState({ done: { ...s.done, [step]: true }, lastProgressAt: now(), stalled: false });
}

/** 3D 无法使用：首页照常进入（静态背景），不让玩家卡在加载页 */
export function markBootDegraded() {
  if (useBoot.getState().degraded) return;
  useBoot.setState({ degraded: true, stalled: false, lastProgressAt: now() });
}

export function markBootStalled() {
  if (!bootReady(useBoot.getState())) useBoot.setState({ stalled: true });
}

/** 重试：只重新准备 3D（重建画布）。页面代码、存档、连接都不会重复初始化 */
export function retryBoot() {
  const s = useBoot.getState();
  useBoot.setState({
    done: { ...NONE, core: s.done.core },
    degraded: false,
    stalled: false,
    attempt: s.attempt + 1,
    lastProgressAt: now(),
  });
}

/** 0 ~ 100：已经完成的步骤权重之和 */
export function bootProgress(s: Pick<BootState, 'done' | 'degraded'>): number {
  if (bootReady(s)) return 100;
  return BOOT_STEPS.reduce((sum, st) => sum + (s.done[st.id] ? st.weight : 0), 0);
}

/** 可以进入首页：所有步骤完成；或 3D 不可用（简化模式）且页面本身已就绪 */
export function bootReady(s: Pick<BootState, 'done' | 'degraded'>): boolean {
  if (s.degraded) return s.done.core;
  return BOOT_STEPS.every((st) => s.done[st.id]);
}

/** 当前显示的文字：第一个还没完成的步骤 */
export function bootLabel(s: Pick<BootState, 'done' | 'degraded'>): string {
  if (s.degraded) return s.done.core ? DEGRADED_LABEL : BOOT_STEPS[0].label;
  if (bootReady(s)) return READY_LABEL;
  return (BOOT_STEPS.find((st) => !s.done[st.id]) ?? BOOT_STEPS[0]).label;
}

/** 测试用：恢复初始状态 */
export function resetBootForTest() {
  useBoot.setState({ done: { ...NONE }, degraded: false, stalled: false, attempt: 0, lastProgressAt: now() });
}
