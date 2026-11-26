// 百家乐结算（游客，在本机）：与服务器使用同一套规则 applyBaccaratRound；每局只结算一次（roundId）。
// 登录玩家的奖励由服务器结算并推送，这里什么都不做。
import { useEffect, useRef } from 'react';
import { betTotal } from '../core/baccarat/rules';
import type { BacEconomy, BacRoundFacts, BaccaratView } from '../core/baccarat/types';
import { SPECIES, SPECIES_MAP } from '../core/player/profile';
import { sound } from '../audio/sound';
import { useGame } from '../store/gameStore';
import { isAccountMode, useProfile } from '../store/profileStore';
import { ACHIEVEMENTS, isSpeciesUnlocked, levelFromXp } from './progression';
import { applyBaccaratRound } from './rewards';
import { BlackjackGate } from './blackjackTracker';

/** 成就 / 升级提示在结果演出之后再出现 */
const TOAST_DELAY = 3800;

export function settleGuestBaccarat(f: BacRoundFacts, economy: BacEconomy) {
  if (isAccountMode()) return;
  const st = useProfile.getState();
  const before = { level: levelFromXp(st.xp), ach: st.achievements };
  const { stats, xp } = applyBaccaratRound(st.stats, f);
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
export function factsFromBacView(v: BaccaratView): BacRoundFacts | null {
  const me = v.players.find((p) => p.id === v.viewerId);
  if (v.phase !== 'round-end' || !v.result || !me?.placed || !me.returns) return null;
  const bet = betTotal(me.bets);
  const payout = betTotal(me.returns);
  const natural = v.hands.player.natural || v.hands.banker.natural;
  return { roundId: v.roundId, bets: { ...me.bets }, returns: { ...me.returns }, bet, payout, profit: payout - bet, winner: v.result.winner, playerScore: v.result.player, bankerScore: v.result.banker, natural };
}

/** 在线房间里的游客：根据服务器的结果在本机记录经验与统计（桌上筹码不影响持久金币）。本地对局由控制器直接结算 */
export function useBaccaratProgress(view: BaccaratView | null, mode: 'local' | 'online' | null) {
  const gate = useRef(new BlackjackGate()).current;
  useEffect(() => {
    if (!view || !mode) return gate.reset();
    if (mode !== 'online' || isAccountMode()) return;
    if (!gate.due(view)) return;
    const f = factsFromBacView(view);
    if (f) settleGuestBaccarat(f, 'table');
  }, [view, mode, gate]);
}
