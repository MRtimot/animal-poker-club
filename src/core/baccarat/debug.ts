// 仅供测试与开发调试：指定接下来发出的牌（发牌顺序：闲 1、庄 1、闲 2、庄 2、第三张…）。
// 只在已有的牌靴里“交换位置”（不会凭空多出牌），正式构建不引用这个文件（见 localBaccarat 的动态加载）。
import { cardFromCode } from '../cards/physical';
import { BaccaratEngine } from './engine';

export function rigBacNext(e: BaccaratEngine, ids: readonly string[]): BaccaratEngine {
  const s = e.toState();
  const order = [...s.shoe.order];
  ids.forEach((id, k) => {
    const at = s.shoe.next + k;
    const from = order.findIndex((c, i) => i >= at && cardFromCode(c).id === id);
    if (from < 0) throw new Error('牌靴里找不到 ' + id);
    [order[at], order[from]] = [order[from], order[at]];
  });
  return BaccaratEngine.fromState({ ...s, shoe: { ...s.shoe, order } });
}
