// 21 点结果演出的状态（纯表现）：结果在这之前已经由引擎 / 服务器确定，演出与跳过都不影响任何数字。
import { create } from 'zustand';
import type { BjSeatView, BlackjackView } from '../../core/blackjack/types';

export type BjOutcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'dealer-blackjack';
/** hush 安静下来 → verdict 结果揭晓 → payout 筹码移动 */
export type BjCinePhase = 'hush' | 'verdict' | 'payout';

export interface BjCine {
  roundId: string;
  outcome: BjOutcome;
  profit: number;
  bet: number;
  value: number;
  dealerValue: number;
  phase: BjCinePhase;
}

export const OUTCOME_TITLE: Record<BjOutcome, { en: string; zh: string }> = {
  blackjack: { en: 'BLACKJACK', zh: '黑杰克' },
  win: { en: 'WIN', zh: '你赢了' },
  push: { en: 'PUSH', zh: '平局 · 下注退回' },
  lose: { en: 'LOSS', zh: '庄家赢' },
  bust: { en: 'BUST', zh: '爆牌' },
  'dealer-blackjack': { en: 'DEALER BLACKJACK', zh: '庄家黑杰克' },
};

/** 每种结果的节奏（毫秒）：黑杰克最隆重，平局最短 */
export const CINE_TIMING: Record<BjOutcome, { hush: number; verdict: number; payout: number }> = {
  blackjack: { hush: 750, verdict: 2300, payout: 1300 },
  win: { hush: 550, verdict: 1700, payout: 1150 },
  push: { hush: 250, verdict: 1300, payout: 700 },
  lose: { hush: 650, verdict: 1700, payout: 900 },
  bust: { hush: 450, verdict: 1600, payout: 800 },
  'dealer-blackjack': { hush: 800, verdict: 1900, payout: 900 },
};

interface CineState {
  cine: BjCine | null;
  /** 这一局的筹码在画面上已经派完（下注圈清空、余额更新） */
  paidRound: string | null;
  set: (p: Partial<Pick<CineState, 'cine' | 'paidRound'>>) => void;
}

export const useBjCine = create<CineState>()((set) => ({ cine: null, paidRound: null, set: (p) => set(p) }));

export function resetBjCine() {
  useBjCine.setState({ cine: null, paidRound: null });
}

/** 一名玩家这一局的整体结果（多手时看净输赢） */
export function outcomeOf(p: Pick<BjSeatView, 'hands'>): { outcome: BjOutcome; profit: number; bet: number } | null {
  if (!p.hands.length || p.hands.some((h) => !h.result)) return null;
  const bet = p.hands.reduce((s, h) => s + h.bet, 0);
  const profit = p.hands.reduce((s, h) => s + h.payout, 0) - bet;
  const all = (r: string) => p.hands.every((h) => h.result === r);
  const outcome: BjOutcome =
    p.hands.some((h) => h.result === 'blackjack') ? 'blackjack' : all('bust') ? 'bust' : profit > 0 ? 'win' : profit === 0 ? 'push' : all('dealer-blackjack') ? 'dealer-blackjack' : 'lose';
  return { outcome, profit, bet };
}

export function buildCine(view: BlackjackView): BjCine | null {
  const me = view.players.find((p) => p.id === view.viewerId);
  const o = me && outcomeOf(me);
  if (!me || !o) return null;
  return { roundId: view.roundId, ...o, value: me.hands[0].value, dealerValue: view.dealer.value, phase: 'hush' };
}
