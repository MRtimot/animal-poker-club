// 庄家游戏（21 点、百家乐）接入全局失败演出的适配层：
// 从引擎 / 服务器已经确定的结果（视图里的下注、返还、余额）算出全局结果 RoundOutcome，
// 再交给与德州共用的 verdictOf 与失败演出导演。这里只读结果，不改变任何牌局状态。
// · 输家永远是观看者自己（每个客户端只演自己的失败，与德州一致）；赢家是动物庄家（庄家本身不会被处决）
// · 打平 / 和局退回 / 赢：净输赢不为负，不演
import type { BaccaratView } from '../../core/baccarat/types';
import { BAC_DEALER_ID } from '../../core/baccarat/types';
import type { BlackjackView } from '../../core/blackjack/types';
import { DEALER_ID } from '../../core/blackjack/types';
import { betTotal } from '../../core/baccarat/rules';
import type { PlayerProfile } from '../../core/player/profile';
import type { AIPersonality } from '../../core/ai/ai';
import type { GameMode } from '../../core/gameMode';
import type { SeatLayout } from '../../three/layout';
import { computeBaccaratLayout } from '../../three/baccarat/layout';
import { computeBlackjackLayout } from '../../three/blackjack/layout';
import { outcomeOf } from '../blackjack/cineStore';
import { HOUSE_HEAVY_MIN_BETS, type RoundOutcome } from './defeatRules';

/** 演出需要的“舞台”：谁在场（转头、反应）、座位在哪里（镜头、冲击中心）、这是哪一局 */
export interface CastMember {
  id: string;
  profile: Pick<PlayerProfile, 'animal'>;
  aiPersonality?: AIPersonality | null;
  busted: boolean;
  sittingOut: boolean;
}
export interface DefeatStage {
  mode: GameMode;
  /** 局号（德州：第几手）；下一局开始时简短版立即结束 */
  round: number;
  viewerId: string;
  layout: Map<string, SeatLayout>;
  cast: CastMember[];
}

export function baccaratOutcome(v: BaccaratView): RoundOutcome | null {
  const me = v.players.find((p) => p.id === v.viewerId);
  if (!me || me.left || !me.placed || !me.returns || !v.result) return null;
  const lost = Math.max(0, betTotal(me.bets) - betTotal(me.returns));
  // 结算在“结果”事件之前就已经完成：视图里的余额就是这一局之后的余额
  return { lost, startStack: me.balance + lost, busted: me.balance < v.rules.minBet, heavyMin: HOUSE_HEAVY_MIN_BETS * v.rules.minBet };
}

export function blackjackOutcome(v: BlackjackView): RoundOutcome | null {
  const me = v.players.find((p) => p.id === v.viewerId);
  const o = me && !me.left ? outcomeOf(me) : null;
  if (!me || !o) return null;
  const lost = Math.max(0, -o.profit);
  return { lost, startStack: me.balance + lost, busted: me.balance < v.rules.minBet, heavyMin: HOUSE_HEAVY_MIN_BETS * v.rules.minBet };
}

function houseCast(players: readonly { id: string; left: boolean; isAI: boolean; aiPersonality?: AIPersonality; profile: PlayerProfile }[], dealerId: string, dealer: PlayerProfile): CastMember[] {
  return [
    ...players.filter((p) => !p.left).map((p) => ({ id: p.id, profile: p.profile, aiPersonality: p.isAI ? (p.aiPersonality ?? null) : null, busted: false, sittingOut: false })),
    { id: dealerId, profile: dealer, aiPersonality: null, busted: false, sittingOut: false },
  ];
}

export function baccaratStage(v: BaccaratView): DefeatStage {
  return { mode: 'baccarat', round: v.round, viewerId: v.viewerId, layout: computeBaccaratLayout(v), cast: houseCast(v.players, BAC_DEALER_ID, v.dealer.profile) };
}

export function blackjackStage(v: BlackjackView): DefeatStage {
  return { mode: 'blackjack-21', round: v.round, viewerId: v.viewerId, layout: computeBlackjackLayout(v), cast: houseCast(v.players, DEALER_ID, v.dealer.profile) };
}

/** 赢家：动物庄家（两种牌桌的庄家编号相同） */
export const HOUSE_WINNER_ID = DEALER_ID;
