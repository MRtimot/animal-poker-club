// 手机触感反馈（震动）：只在支持 navigator.vibrate 的浏览器上生效（多数安卓浏览器；iPhone 不支持），
// 可以在设置里关闭；电脑版不震动；系统开启“减少动态效果”时只保留很轻的反馈。
// 震动失败或不支持时静默忽略，不影响游戏。
import { useSettings } from '../store/settingsStore';
import { isPC } from '../utils/pc';
import { prefersReducedMotion } from '../utils/reducedMotion';

export type HapticKind = 'tap' | 'action' | 'impact' | 'defeat';

const PATTERN: Record<HapticKind, number | number[]> = {
  tap: 8,
  action: 14,
  impact: [22, 40, 18],
  defeat: [40, 70, 60, 90, 120],
};

export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function haptic(kind: HapticKind) {
  if (!hapticsSupported() || isPC() || !useSettings.getState().haptics) return;
  try {
    navigator.vibrate(prefersReducedMotion() && kind !== 'tap' ? 10 : PATTERN[kind]);
  } catch {
    /* 浏览器拒绝（例如还没有用户交互）：忽略 */
  }
}
