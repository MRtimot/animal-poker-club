// 根据牌局结果给本地玩家结算经验、统计与成就
import { useEffect, useRef } from 'react';
import type { TableView } from '../core/game/view';
import { useProfile } from '../store/profileStore';
import { useGame } from '../store/gameStore';
import { ACHIEVEMENTS, levelFromXp } from './progression';
import { applyGame, applyHand, effectiveBet } from './rewards';
import { SPECIES, SPECIES_MAP } from '../core/player/profile';
import { isSpeciesUnlocked } from './progression';
import { sound } from '../audio/sound';
import { isAccountMode } from '../store/profileStore';

export function useProgressTracker(view: TableView | null, mode: 'local' | 'online' | null) {
  const doneHand = useRef<number>(-1);
  const doneGame = useRef(false);
  const startHand = useRef<number | null>(null);

  useEffect(() => {
    if (!view || !mode) return;
    // 登录玩家的进度由服务器结算，客户端不计算、不提交任何奖励
    if (isAccountMode()) return;
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

    // 一手牌结束（游客：使用与服务器完全相同的规则在本机结算）
    if (view.phase === 'complete' && view.summary && view.handNumber !== doneHand.current) {
      doneHand.current = view.handNumber;
      if (me.inHand) {
        const win = view.summary.winners.find((w) => w.playerId === me.id);
        const shown = view.summary.shown.find((s) => s.playerId === me.id);
        const st = useProfile.getState();
        const before = { level: levelFromXp(st.xp), ach: st.achievements };
        const { stats, xp } = applyHand(st.stats, {
          won: !!win,
          amount: win?.amount ?? 0,
          bet: effectiveBet(me.totalBet, view.events as any, me.id),
          category: win && shown ? shown.category : -1,
          allIn: me.allIn,
          folded: me.folded,
          uncontested: view.summary.uncontested,
          species: st.animal.species,
          online: mode === 'online',
        });
        report(st.applyProgress(xp, () => stats), before);
      }
    }

    // 整场结束
    if (view.gameOver && !doneGame.current) {
      doneGame.current = true;
      const rank = view.gameOver.rankings.find((r) => r.playerId === me.id);
      const st = useProfile.getState();
      const before = { level: levelFromXp(st.xp), ach: st.achievements };
      const { stats, xp } = applyGame(
        st.stats,
        { place: rank?.place ?? view.players.length, players: view.players.length, hands: view.handNumber, finalChips: me.chips, mode },
        false,
      );
      const res = st.applyProgress(xp, () => stats);
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
