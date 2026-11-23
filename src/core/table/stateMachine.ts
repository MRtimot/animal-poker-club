// 牌局状态机：唯一的阶段来源是扑克引擎（服务器 / 本地主机）。
// UI 与 3D 只读取阶段并据此展示，从不自行推进阶段。
//
//  WAITING ─→ PRE_FLOP ─→ FLOP ─→ TURN ─→ RIVER ─→ SHOWDOWN ─→ PAYOUT ─→ （下一手）PRE_FLOP
//                 │          │       │        │                    ▲
//                 └──────────┴───────┴────────┴── 其他人全部弃牌 ──┘
//
// 与引擎阶段的对应：idle = WAITING，preflop…river = 下注街，showdown = SHOWDOWN，
// complete = PAYOUT（派奖完成，等待下一手；nextHandAt 有值时即 NEXT_HAND 倒计时）。
// STARTING（洗牌、下盲注、发底牌）发生在进入 preflop 的同一步里，用 handStart / blind / dealHole 事件表示。
import type { ActionType, Phase } from './types';

export const PHASE_TRANSITIONS: Record<Phase, readonly Phase[]> = {
  idle: ['preflop'],
  preflop: ['flop', 'complete'],
  flop: ['turn', 'complete'],
  turn: ['river', 'complete'],
  river: ['showdown', 'complete'],
  showdown: ['complete'],
  complete: ['preflop'],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

/** 每个阶段允许的玩家动作（具体是否合法仍由引擎按筹码、轮次逐一校验） */
export const PHASE_ACTIONS: Record<Phase, readonly ActionType[]> = {
  idle: [],
  preflop: ['fold', 'check', 'call', 'raise', 'allin'],
  flop: ['fold', 'check', 'call', 'raise', 'allin'],
  turn: ['fold', 'check', 'call', 'raise', 'allin'],
  river: ['fold', 'check', 'call', 'raise', 'allin'],
  showdown: [],
  complete: [],
};

/** 界面上的阶段进度条（等待 / 派奖不在进度条里） */
export const STREET_STEPS: readonly Phase[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
