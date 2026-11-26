// 筹码用完时补给面板的文字（21 点、百家乐共用）。次数由服务器 / 本地主机在视图里给出，这里只负责显示。
import { REFILLS_PER_DAY, ROOM_REBUYS } from '../../core/refill';

export interface RefillCopy {
  /** 还能不能补充 */
  canRefill: boolean;
  button: string;
  /** 次数说明（没有限制时为空） */
  note: string;
}

export function refillCopy(v: { economy: 'profile' | 'table'; refillsLeft: number | null }): RefillCopy {
  const left = v.refillsLeft;
  if (v.economy === 'profile') {
    if (left === null) return { canRefill: true, button: '领取俱乐部补给', note: '' };
    if (left <= 0) return { canRefill: false, button: '今天的补给已经用完', note: `今天的 ${REFILLS_PER_DAY} 次俱乐部补给已经用完，明天 0 点（马来西亚时间）恢复。` };
    return { canRefill: true, button: `领取俱乐部补给（今天还剩 ${left} 次）`, note: `每天 ${REFILLS_PER_DAY} 次，21 点和百家乐共用。` };
  }
  if (left === null) return { canRefill: true, button: '补充筹码', note: '' };
  if (left <= 0) return { canRefill: false, button: '补充次数已经用完', note: `这个房间里的 ${ROOM_REBUYS} 次补充筹码已经用完，接下来只能旁观。` };
  return { canRefill: true, button: `补充筹码（还剩 ${left} 次）`, note: `每个房间每人最多补充 ${ROOM_REBUYS} 次。` };
}
