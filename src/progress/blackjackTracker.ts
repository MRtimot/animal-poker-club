// 21 点结算（游客，在本机）：与服务器使用同一套规则 applyBlackjackRound；每局只结算一次（roundId）。
// 登录玩家的奖励由服务器结算并推送，这里什么都不做。
import { useEffect, useRef } from 'react';
import type { BjEconomy, BjRoundFacts, BlackjackView } from '../core/blackjack/types';
import { SPECIES, SPECIES_MAP } from '../core/player/profile';
import { sound } from '../audio/sound';
import { useGame } from '../store/gameStore';
import { isAccountMode, useProfile } from '../store/profileStore';
import { ACHIEVEMENTS, isSpeciesUnlocked, levelFromXp } from './progression';
import { applyBlackjackRound } from './rewards';

/** 成就 / 升级提示等结果演出之后再出现，不提前剧透 */
const TOAST_DELAY = 2600;

export function settleGuestRound(f: BjRoundFacts, economy: BjEconomy) {
  if (isAccountMode()) return;
  const st = useProfile.getState();
  const before = { level: levelFromXp(st.xp), ach: st.achievements };
  const { stats, xp } = applyBlackjackRound(st.stats, f);
  const res = st.settleTableRound(f.roundId, xp, stats, economy === 'profile' ? f.profit : 0);
  if (!res || (!res.newAchievements.length && !res.levelUp)) return;
  setTimeout(() => {
    const toast = useGame.getState().toast;
    for (const id of res.newAchievements) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) toast(`${a.icon} 达成成就：${a.name}`, 'unlock');
    }
    if (res.levelUp) toast(`🎉 升级！你现在是 ${res.levelUp} 级`, 'unlock');
    sound.play('unlock', 0.4);
    const now = useProfile.getState();
    const lvl = res.levelUp ?? before.level;
    for (const s of SPECIES) if (!isSpeciesUnlocked(s.id, before.level, before.ach) && isSpeciesUnlocked(s.id, lvl, now.achievements)) toast(`${s.emoji} 解锁新动物：${SPECIES_MAP[s.id].name}！`, 'unlock');
  }, TOAST_DELAY);
}

/** 从视图里取出自己这一局的结算事实（只在一局结束后） */
export function factsFromView(v: BlackjackView): BjRoundFacts | null {
  const me = v.players.find((p) => p.id === v.viewerId);
  if (v.phase !== 'round-end' || !me?.hands.length || me.hands.some((h) => !h.result)) return null;
  const bet = me.hands.reduce((s, h) => s + h.bet, 0);
  const payout = me.hands.reduce((s, h) => s + h.payout, 0);
  return { roundId: v.roundId, bet, payout, profit: payout - bet, hands: me.hands.map((h) => ({ result: h.result!, value: h.value, cards: h.cards.length, doubled: h.doubled, fromSplit: h.fromSplit })), dealerBust: v.dealer.bust };
}

/** 决定这一局要不要结算：第一次看到就已经结束的（刷新 / 重连）不再发；同一局只发一次 */
export class BlackjackGate {
  private last: string | null = null;
  private seen = false;
  reset() {
    this.last = null;
    this.seen = false;
  }
  due(v: { roundId: string; phase: string }): boolean {
    const first = !this.seen;
    this.seen = true;
    if (v.phase !== 'round-end' || v.roundId === this.last) return false;
    this.last = v.roundId;
    return !first;
  }
}

/** 在线房间里的游客：根据服务器的结果在本机记录经验与统计（桌上筹码不影响持久金币）。本地对局由控制器直接结算 */
export function useBlackjackProgress(view: BlackjackView | null, mode: 'local' | 'online' | null) {
  const gate = useRef(new BlackjackGate()).current;
  useEffect(() => {
    if (!view || !mode) return gate.reset();
    if (mode !== 'online' || isAccountMode()) return;
    if (!gate.due(view)) return;
    const f = factsFromView(view);
    if (f) settleGuestRound(f, 'table');
  }, [view, mode, gate]);
}
