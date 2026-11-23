// 一组可以整体取消的延时任务：到点执行后自动移除（集合不会越积越大），离开牌桌时一次全部取消
export class TimerBag {
  private ids = new Set<ReturnType<typeof setTimeout>>();

  /** 延时执行 fn；返回计时器编号 */
  later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.ids.delete(id);
      fn();
    }, Math.max(0, ms));
    this.ids.add(id);
    return id;
  }

  /** 取消所有还没执行的任务 */
  cancelAll(): void {
    for (const id of this.ids) clearTimeout(id);
    this.ids.clear();
  }

  /** 还在等待执行的任务数 */
  get size(): number {
    return this.ids.size;
  }
}
