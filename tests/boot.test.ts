// 电脑版加载页的启动进度：只在真实步骤完成时增加；就绪条件；3D 不可用时不阻塞；卡住与重试
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import {
  BOOT_STEPS,
  DEGRADED_LABEL,
  READY_LABEL,
  bootLabel,
  bootProgress,
  bootReady,
  markBoot,
  markBootDegraded,
  markBootStalled,
  resetBootForTest,
  retryBoot,
  useBoot,
} from '../src/boot/boot';

beforeEach(() => resetBootForTest());

describe('启动进度', () => {
  it('BOOT-01 权重合计 100；进度等于已完成步骤的权重之和，按顺序完成时只增不减', () => {
    expect(BOOT_STEPS.reduce((a, s) => a + s.weight, 0)).toBe(100);
    expect(bootProgress(useBoot.getState())).toBe(0);
    let last = 0;
    let expected = 0;
    for (const st of BOOT_STEPS) {
      expect(bootLabel(useBoot.getState())).toBe(st.label);
      markBoot(st.id);
      expected += st.weight;
      const p = bootProgress(useBoot.getState());
      expect(p).toBe(expected);
      expect(p).toBeGreaterThan(last);
      last = p;
    }
    expect(bootReady(useBoot.getState())).toBe(true);
    expect(bootLabel(useBoot.getState())).toBe(READY_LABEL);
  });

  it('BOOT-02 没有新的步骤完成时进度不变（不会随时间自己增长）；同一步骤重复报告不会重复计算', async () => {
    markBoot('core');
    const p = bootProgress(useBoot.getState());
    await new Promise((r) => setTimeout(r, 50));
    expect(bootProgress(useBoot.getState())).toBe(p);
    markBoot('core');
    expect(bootProgress(useBoot.getState())).toBe(p);
  });

  it('BOOT-03 还差最后一步时不会显示 100%，也不算就绪', () => {
    for (const st of BOOT_STEPS.slice(0, -1)) markBoot(st.id);
    expect(bootReady(useBoot.getState())).toBe(false);
    expect(bootProgress(useBoot.getState())).toBeLessThan(100);
  });

  it('BOOT-04 3D 不可用：页面本身就绪后直接进入首页（简化模式），不会卡在加载页', () => {
    markBootDegraded();
    expect(bootReady(useBoot.getState())).toBe(false); // 页面代码还没就绪
    markBoot('core');
    const s = useBoot.getState();
    expect(bootReady(s)).toBe(true);
    expect(bootProgress(s)).toBe(100);
    expect(bootLabel(s)).toBe(DEGRADED_LABEL);
  });

  it('BOOT-05 卡住与重试：重试只重置 3D 相关步骤，页面步骤保留；任何步骤完成都会清除“卡住”', () => {
    markBoot('core');
    markBoot('gl');
    markBootStalled();
    expect(useBoot.getState().stalled).toBe(true);
    const attempt = useBoot.getState().attempt;
    retryBoot();
    const s = useBoot.getState();
    expect(s.attempt).toBe(attempt + 1);
    expect(s.stalled).toBe(false);
    expect(s.done).toEqual({ core: true, gl: false, scene: false, shaders: false, frames: false });
    markBootStalled();
    markBoot('gl');
    expect(useBoot.getState().stalled).toBe(false);
    // 已经就绪时不会被标记为卡住
    for (const st of BOOT_STEPS) markBoot(st.id);
    markBootStalled();
    expect(useBoot.getState().stalled).toBe(false);
  });

  it('BOOT-06 加载页（电脑版与手机版）不使用计时器或随机数“推进”进度（只读取真实步骤）', () => {
    const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    const src = ['../src/ui/boot/PremiumLoader.tsx', '../src/ui/boot/MobileLoader.tsx', '../src/ui/boot/useLoaderFlow.ts', '../src/boot/boot.ts'].map(read).join('\n');
    expect(src).not.toMatch(/Math\.random/);
    // 唯一的 setInterval 是卡住检测（只读状态、不修改进度）
    const intervals = src.match(/setInterval\(/g) ?? [];
    expect(intervals.length).toBe(1);
    expect(src).toMatch(/markBootStalled\(\)/);
    // 两个画面都使用同一套流程，不各自实现
    expect(read('../src/ui/boot/PremiumLoader.tsx')).toMatch(/useLoaderFlow\(/);
    expect(read('../src/ui/boot/MobileLoader.tsx')).toMatch(/useLoaderFlow\(/);
    // 原来手机上用随机数增长的模拟进度已经移除
    const app = read('../src/App.tsx');
    expect(app).not.toMatch(/function LoadingScreen/);
    expect(app).not.toMatch(/Math\.random\(\) \* 18/);
  });
});
