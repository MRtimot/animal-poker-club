// 百家乐结果演出的状态（纯表现）：结果在这之前已经由引擎 / 服务器确定，演出与跳过都不影响任何数字。
import { create } from 'zustand';
import { betTotal, type BacWinner } from '../../core/baccarat/rules';
import type { BaccaratView } from '../../core/baccarat/types';

/** hush 桌面安静 → verdict 宣布结果 → payout 筹码移动 */
export type BacCinePhase = 'hush' | 'verdict' | 'payout';

export interface BacCine {
  roundId: string;
  winner: BacWinner;
  player: number;
  banker: number;
  natural: boolean;
  /** 自己这一局的净输赢（没下注时为 null） */
  profit: number | null;
  bet: number;
  phase: BacCinePhase;
}

export const WINNER_TITLE: Record<BacWinner, { en: string; zh: string }> = {
  player: { en: 'PLAYER WINS', zh: '闲赢' },
  banker: { en: 'BANKER WINS', zh: '庄赢' },
  tie: { en: 'TIE', zh: '和局' },
};

/** 节奏（毫秒）：和局停顿最久 */
export const BAC_CINE_TIMING: Record<BacWinner, { hush: number; verdict: number; payout: number }> = {
  player: { hush: 450, verdict: 1900, payout: 1100 },
  banker: { hush: 450, verdict: 1900, payout: 1100 },
  tie: { hush: 900, verdict: 2300, payout: 1100 },
};

interface CineState {
  cine: BacCine | null;
  paidRound: string | null;
  set: (p: Partial<Pick<CineState, 'cine' | 'paidRound'>>) => void;
}

export const useBacCine = create<CineState>()((set) => ({ cine: null, paidRound: null, set: (p) => set(p) }));

export function resetBacCine() {
  useBacCine.setState({ cine: null, paidRound: null });
}

export function buildBacCine(view: BaccaratView): BacCine | null {
  if (!view.result) return null;
  const me = view.players.find((p) => p.id === view.viewerId);
  const placed = !!me?.placed && !!me.returns;
  return {
    roundId: view.roundId,
    winner: view.result.winner,
    player: view.result.player,
    banker: view.result.banker,
    natural: view.hands.player.natural || view.hands.banker.natural,
    profit: placed ? betTotal(me!.returns!) - betTotal(me!.bets) : null,
    bet: placed ? betTotal(me!.bets) : 0,
    phase: 'hush',
  };
}
