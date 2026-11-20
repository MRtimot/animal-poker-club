// 根据牌局结果给本地玩家结算经验、统计与成就
import { useEffect, useRef } from 'react';
import type { TableView } from '../core/game/view';
import { useProfile } from '../store/profileStore';
import { useGame } from '../store/gameStore';
import { ACHIEVEMENTS, XP_RULES, levelFromXp } from './progression';
import { SPECIES, SPECIES_MAP } from '../core/player/profile';
import { isSpeciesUnlocked } from './progression';
import { sound } from '../audio/sound';

export function useProgressTracker(view: TableView | null, mode: 'local' | 'online' | null) {
  const doneHand = useRef<number>(-1);
  const doneGame = useRef(false);
  const startHand = useRef<number | null>(null);

  useEffect(() => {
    if (!view || !mode) return;
    const me = view.players.find((p) => p.id === view.viewerId);
    if (!me) return;
    if (startHand.current !== null && view.handNumber < startHand.current) {
      // 新开了一场（再来一局 / 新房间）
      startHand.current = null;
      doneHand.current = -1;
    }
    // 从第一手真正发牌开始计数（第 0 手是还没发牌的空桌）
    if (startHand.current === null && view.handNumber >= 1) {
      startHand.current = view.handNumber;
      // 重连时不重复结算已完成的牌局
      if (view.phase === 'complete') doneHand.current = view.handNumber;
    }

    const toast = useGame.getState().toast;
    const report = (res: { newAchievements: string[]; levelUp: number | null }, before: { level: number; ach: Record<string, number> }) => {
      for (const id of res.newAchievements) {
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        if (a) toast(`${a.icon} 达成成就：${a.name}`, 'unlock');
      }
      if (res.levelUp) {
        toast(`🎉 升级！你现在是 ${res.levelUp} 级`, 'unlock');
      }
      if (res.levelUp || res.newAchievements.length) {
        sound.play('unlock', 0.6);
        const st = useProfile.getState();
        const lvl = res.levelUp ?? before.level;
        for (const s of SPECIES) {
          const was = isSpeciesUnlocked(s.id, before.level, before.ach);
          const now = isSpeciesUnlocked(s.id, lvl, st.achievements);
          if (!was && now) toast(`${s.emoji} 解锁新动物：${SPECIES_MAP[s.id].name}！`, 'unlock');
        }
      }
    };

    // 一手牌结束
    if (view.phase === 'complete' && view.summary && view.handNumber !== doneHand.current) {
      doneHand.current = view.handNumber;
      const dealtIn = me.inHand;
      if (dealtIn) {
        const win = view.summary.winners.find((w) => w.playerId === me.id);
        const shown = view.summary.shown.find((s) => s.playerId === me.id);
        const st = useProfile.getState();
        const before = { level: levelFromXp(st.xp), ach: st.achievements };
        const species = st.animal.species;
        let xp = XP_RULES.handPlayed;
        const res = st.applyProgress(0, (s) => {
          s.handsPlayed++;
          if (mode === 'online') s.onlineHands++;
          if (win) {
            s.handsWon++;
            s.currentStreak++;
            s.bestStreak = Math.max(s.bestStreak, s.currentStreak);
            s.biggestPot = Math.max(s.biggestPot, win.amount);
            if (shown) s.bestHand = Math.max(s.bestHand, shown.category);
            if (me.allIn && !view.summary!.uncontested) s.allInWins++;
            if (view.summary!.uncontested) s.uncontestedWins++;
            s.speciesWins[species] = (s.speciesWins[species] ?? 0) + 1;
            xp += XP_RULES.handWon + Math.min(XP_RULES.streakBonusMax, XP_RULES.streakBonusPer * (s.currentStreak - 1));
          } else {
            s.currentStreak = 0;
          }
          return s;
        });
        const res2 = useProfile.getState().applyProgress(xp, (s) => s);
        report({ newAchievements: [...res.newAchievements, ...res2.newAchievements], levelUp: res2.levelUp ?? res.levelUp }, before);
      }
    }

    // 整场结束
    if (view.gameOver && !doneGame.current) {
      doneGame.current = true;
      const rank = view.gameOver.rankings.find((r) => r.playerId === me.id);
      const st = useProfile.getState();
      const before = { level: levelFromXp(st.xp), ach: st.achievements };
      const won = view.gameOver.winnerId === me.id;
      const res = st.applyProgress(won ? XP_RULES.gameWon : 0, (s) => {
        s.gamesPlayed++;
        if (won) s.gamesWon++;
        return s;
      });
      st.addRecent({
        time: Date.now(),
        mode,
        place: rank?.place ?? view.players.length,
        players: view.players.length,
        hands: view.handNumber - (startHand.current ?? 1) + 1,
        chips: me.chips,
      });
      report(res, before);
    }
    if (!view.gameOver) doneGame.current = false;
  }, [view, mode]);
}
