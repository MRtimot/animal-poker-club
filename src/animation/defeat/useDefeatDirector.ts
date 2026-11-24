// 失败演出导演：读取真实的牌局结果（服务器 / 本地引擎的 win 事件与座位筹码），在自己输掉关键一手时
// 按时间表推进演出阶段，并在每个阶段触发一次性的动作、声音与反应。
// · 演出从“赢家演出”出现的那一刻开始（与事件导演的节奏完全对齐），不提前剧透、不延后牌局
// · 只控制画面、声音与动画：不修改、不同步任何牌局 / 房间 / 玩家状态（在线时每个客户端只演自己的失败）
// · 任何打断（离开牌桌、断线、简短版遇到下一手开始、页面卸载）都会立刻清理：计时器、声音、动画、镜头、灯光
import { useEffect, useRef } from 'react';
import type { TableView } from '../../core/game/view';
import { TimerBag } from '../timerBag';
import { useFx, type AnimName } from '../../store/fxStore';
import { useGame } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { sound } from '../../audio/sound';
import { voice } from '../../audio/voice';
import { haptic } from '../../display/haptics';
import { computeLayout } from '../../three/layout';
import { isPC } from '../../utils/pc';
import { prefersReducedMotion } from '../../utils/reducedMotion';
import {
  BYSTANDER_REACTION,
  COLLAPSE_BY_SPECIES,
  PHASE_ORDER,
  REALIZE_BY_SPECIES,
  WINNER_REACTION,
  buildTimeline,
  defeatProfile,
  defeatVerdict,
  lookOrder,
  winnerStyle,
  type DefeatPhase,
} from './defeatRules';
import { beginDefeat, endDefeat, setDefeatPhase, useDefeat, type DefeatSequence } from './defeatStore';

/** 结束演出时的淡入时间（完整版从黑屏淡回牌桌） */
const RECOVER_MS = 700;

let controller: { skip: () => void; finish: () => void } | null = null;
/** 玩家点击“跳过”（只跳过画面：完整版直接到“出局”画面，简短版直接结束） */
export function skipDefeat() {
  controller?.skip();
}
/** “出局”画面上的“继续”：淡回牌桌并恢复一切 */
export function finishDefeat() {
  controller?.finish();
}

export function useDefeatDirector(view: TableView | null) {
  const viewRef = useRef(view);
  viewRef.current = view;
  const timers = useRef(new TimerBag()).current;
  const drone = useRef<{ stop: (fade?: number) => void } | null>(null);

  /** 立刻清理（打断）：计时器、低频铺底、混音、输家的倒下姿势 */
  const cleanup = (restoreAnim = true) => {
    timers.cancelAll();
    drone.current?.stop(0.08);
    drone.current = null;
    const s = useDefeat.getState().seq;
    if (s) {
      sound.resetMix(0.3);
      document.body.classList.remove('defeat-cine');
      if (restoreAnim) useFx.getState().play(s.loserId, 'settle');
      endDefeat(s.key);
    }
  };

  useEffect(() => {
    controller = {
      skip: () => {
        const s = useDefeat.getState();
        if (!s.seq) return;
        if (s.seq.cut === 'short') return cleanup();
        // 完整版：停止所有排队中的镜头 / 声音，直接到“出局”画面（结果不变，只是不看演出）
        timers.cancelAll();
        drone.current?.stop(0.08);
        drone.current = null;
        sound.setMix({ music: 0, ambient: 0.15, sfx: 0.2 }, 0.2);
        useDefeat.setState({ skipped: true });
        setDefeatPhase(s.seq.key, 'defeated');
        sound.cineSting(0.1);
      },
      finish: () => {
        const s = useDefeat.getState().seq;
        if (!s) return;
        setDefeatPhase(s.key, 'recover');
        sound.resetMix(0.8);
        useFx.getState().play(s.loserId, 'settle');
        timers.later(() => cleanup(false), RECOVER_MS);
      },
    };
    return () => {
      controller = null;
      cleanup();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 离开牌桌：立刻结束
  useEffect(() => {
    if (!view) cleanup();
  }, [!!view]); // eslint-disable-line react-hooks/exhaustive-deps

  // 简短版：下一手已经开始 → 立刻结束（演出不能拖住牌局）
  const hand = view?.handNumber;
  useEffect(() => {
    const s = useDefeat.getState().seq;
    if (s && s.cut === 'short' && hand !== undefined && hand !== s.hand) cleanup();
  }, [hand]); // eslint-disable-line react-hooks/exhaustive-deps

  // 在线断线：立刻结束演出，让重连提示正常显示
  useEffect(
    () =>
      useGame.subscribe((g, prev) => {
        if (g.mode === 'online' && g.conn !== 'connected' && prev.conn === 'connected' && useDefeat.getState().seq) cleanup();
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 简短版：摊牌的牌全部翻开时（玩家已经看到自己输了）就开始——比等赢家演出早约 1.5 秒，
  // 这样在不拖延下一手的前提下有足够的时间演完
  const pendingShort = useRef<string | null>(null);
  useEffect(
    () =>
      useFx.subscribe((fx, prev) => {
        const cue = fx.cue;
        if (!cue || cue.type !== 'showdown' || cue.start === prev.cue?.start) return;
        const v = viewRef.current;
        if (!v || !v.summary || v.summary.handNumber !== v.handNumber || useDefeat.getState().seq) return;
        const verdict = defeatVerdict(v, v.summary.winners.map((w) => w.playerId), v.summary.uncontested);
        if (!verdict || verdict.cut !== 'short') return;
        const winEv = [...v.events].reverse().find((e) => e.type === 'win');
        const key = `${v.handNumber}:${winEv?.seq ?? 'x'}`;
        if (pendingShort.current === key || useDefeat.getState().played.includes(key)) return;
        pendingShort.current = key;
        // 与牌桌上逐个亮牌的节奏一致（每人 650 毫秒），全部翻开后再留一点时间看清
        const reveal = v.summary.shown.length * 650 + 550 + 650;
        timers.later(() => {
          pendingShort.current = null;
          const vv = viewRef.current;
          if (!vv || vv.handNumber !== v.handNumber || useDefeat.getState().seq) return;
          const g = useGame.getState();
          const remaining = vv.nextHandAt ? vv.nextHandAt - (Date.now() + g.clockOffset) - 350 : null;
          const tl = buildTimeline('short', remaining);
          if (!tl) return;
          const merged = new Map<string, number>();
          for (const w of v.summary!.winners) merged.set(w.playerId, (merged.get(w.playerId) ?? 0) + w.amount);
          start(vv, key, verdict, [...merged].map(([playerId, amount]) => ({ playerId, amount })), tl, performance.now());
        }, Math.max(0, cue.start + reveal - performance.now()));
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 赢家演出出现 = 结果揭晓：判断自己是否输掉了关键一手（完整版从这里开始；简短版通常已经在摊牌时开始）
  useEffect(
    () =>
      useFx.subscribe((fx, prev) => {
        const p = fx.presentation;
        if (!p || p.id === prev.presentation?.id) return;
        const v = viewRef.current;
        if (!v || p.hand !== v.handNumber || useDefeat.getState().seq) return;
        const winEv0 = [...v.events].reverse().find((e) => e.type === 'win');
        if (pendingShort.current === `${v.handNumber}:${winEv0?.seq ?? 'x'}`) return;
        const verdict = defeatVerdict(v, p.winners.map((w) => w.playerId), p.uncontested);
        if (!verdict) return;
        const winEv = [...v.events].reverse().find((e) => e.type === 'win');
        const key = `${v.handNumber}:${winEv?.seq ?? p.id}`;
        // 简短版必须在下一手开始前演完：按服务器给出的下一手时间计算剩余时间
        const g = useGame.getState();
        const remaining = v.nextHandAt ? v.nextHandAt - (Date.now() + g.clockOffset) - 350 : null;
        const tl = buildTimeline(verdict.cut, remaining);
        if (!tl) return;
        start(v, key, verdict, p.winners, tl, p.start);
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function start(
    v: TableView,
    key: string,
    verdict: NonNullable<ReturnType<typeof defeatVerdict>>,
    winners: { playerId: string; amount: number }[],
    tl: NonNullable<ReturnType<typeof buildTimeline>>,
    t0: number,
  ) {
    const loserId = v.viewerId;
    let winnerId: string | null = null;
    let best = -1;
    for (const w of winners) if (w.amount > best) ((best = w.amount), (winnerId = w.playerId));
    const layout = computeLayout(v);
    const L = layout.get(loserId);
    const reduced = prefersReducedMotion();
    const profile = defeatProfile({ mobile: !isPC(), quality: useSettings.getState().quality, reduced });
    const at: Partial<Record<DefeatPhase, number>> = {};
    for (const ph of PHASE_ORDER) if (tl.times[ph] !== undefined) at[ph] = t0 + tl.times[ph]!;
    const lookers: Record<string, number> = {};
    const order = lookOrder(v.players, loserId, winnerId, Math.random, tl.scale);
    for (const o of order) lookers[o.id] = (at.reaction ?? t0) + o.delay;
    const seq: DefeatSequence = {
      key,
      hand: v.handNumber,
      cut: verdict.cut,
      loserId,
      winnerId,
      at,
      lookers,
      origin: L ? [L.seat[0], L.seat[2]] : [0, 0],
      lost: verdict.lost,
      ratio: verdict.ratio,
      profile,
      reduced,
    };
    if (!beginDefeat(seq)) return;

    const fx = useFx.getState();
    const seat = (id: string) => v.players.find((p) => p.id === id);
    const species = (id: string) => seat(id)?.profile.animal.species;
    const full = verdict.cut === 'full';
    const when = (absMs: number, fn: () => void) => timers.later(() => {
      if (useDefeat.getState().seq?.key === key) fn();
    }, absMs - performance.now());

    // 阶段切换（界面、镜头、灯光读取这个阶段）
    for (const ph of PHASE_ORDER) {
      const tAbs = at[ph];
      if (tAbs !== undefined) when(tAbs, () => setDefeatPhase(key, ph));
    }

    // ── 结果：所有声音慢慢降下来（音乐约 -8 dB、环境约 -12 dB、牌桌声约 -15 dB），角色停止说话 ──
    sound.setMix({ music: 0.4, ambient: 0.25, sfx: 0.18 }, 0.6);
    voice.stop();

    // ── 赢家特写：按性格反应 ──
    if (full && at.winner !== undefined && winnerId) {
      const w = seat(winnerId);
      when(at.winner, () => {
        document.body.classList.add('defeat-cine');
        if (!w) return;
        const r = WINNER_REACTION[winnerStyle(w)];
        fx.play(w.id, r.anim);
        fx.setMood(w.id, r.emoji, r.face, 2600);
        sound.animal(w.profile.animal.species, 'happy', 0.15, 'cine');
      });
    }

    // ── 输家意识到输了：动作因动物而异；倒吸一口气、心跳开始 ──
    if (at.realize !== undefined) {
      when(at.realize, () => {
        document.body.classList.add('defeat-cine');
        const sp = species(loserId);
        fx.play(loserId, sp ? REALIZE_BY_SPECIES[sp] : 'realizeAccept');
        fx.setMood(loserId, '😨', 'wide', 1200);
        sound.cineBreath('gasp');
        if (sp) sound.animal(sp, 'sad', 0.5, 'cine');
      });
      const span = (at.reaction ?? at.realize + 1500) - at.realize;
      when(at.realize + span * 0.3, () => sound.cineHeartbeat(0.55));
      if (full) when(at.realize + span * 0.85, () => sound.cineHeartbeat(0.65));
    }

    // ── 所有人一个接一个看向输家（每人 0.15~0.35 秒）；房间安静下来 ──
    if (at.reaction !== undefined) {
      for (const o of order) {
        when(lookers[o.id], () => {
          if (o.id === winnerId) return; // 赢家保持自己的反应
          const sp = species(o.id);
          const r = sp ? BYSTANDER_REACTION[sp] : null;
          if (!r) return;
          // 先只是转头（安静地看），稍后才有表情
          timers.later(() => {
            if (useDefeat.getState().seq?.key !== key) return;
            fx.setMood(o.id, r.emoji, r.face, full ? 3000 : 1600);
            if (r.anim === 'stare' || r.anim === 'lookAway') fx.play(o.id, r.anim);
          }, full ? 420 : 200);
        });
      }
      const span = (at.tension ?? at.silence ?? at.reaction + 900) - at.reaction;
      const beats = full ? [0.15, 0.6, 0.95] : [0.2, 0.7];
      beats.forEach((k, i) => when(at.reaction! + span * k, () => sound.cineHeartbeat(0.7 + i * 0.08)));
      if (!full) when(at.reaction + span * 0.4, () => sound.setMix({ music: 0.15, ambient: 0.1, sfx: 0.12 }, 0.4));
    }

    // ── 过肩镜头：低频铺底、发抖的呼吸、心跳加快 ──
    if (at.tension !== undefined) {
      when(at.tension, () => {
        drone.current?.stop();
        drone.current = sound.cineDrone();
        sound.setMix({ music: 0.15, ambient: 0.12, sfx: 0.1 }, 0.5);
        sound.cineBreath('shaky', 0.15);
      });
      [0, 0.38, 0.72].forEach((k, i) => when(at.tension! + 1100 * k, () => sound.cineHeartbeat(0.9 + i * 0.06)));
    }

    // ── 环境特写：心跳最快，最后一声重心跳 ──
    if (at.insert !== undefined && at.silence !== undefined) {
      const span = at.silence - at.insert;
      [0, 0.42].forEach((k, i) => when(at.insert! + span * k, () => sound.cineHeartbeat(1.05 + i * 0.1)));
      when(at.silence - 70, () => {
        sound.cineHeartbeat(1.4);
        haptic('tap');
      });
    }

    // ── 静止：一切突然停止（0.1~0.2 秒） ──
    if (at.silence !== undefined) {
      when(at.silence, () => {
        sound.setMix({ music: 0, ambient: 0, sfx: 0 }, 0.025);
        drone.current?.stop(0.02);
        drone.current = null;
      });
    }

    // ── 冲击：闪光、震动、低频、烟雾、粒子、桌面反应；输家倒下，其他人被吓一跳 ──
    if (at.impact !== undefined) {
      when(at.impact, () => {
        sound.cineImpact(full ? 1 : 0.65);
        sound.cineRing(0.35);
        sound.play('chips', 0.45);
        fx.doShake(profile.shake);
        haptic(full ? 'defeat' : 'impact');
        const sp = species(loserId);
        const collapse: AnimName = full ? (sp ? COLLAPSE_BY_SPECIES[sp] : 'collapseSlump') : 'defeatRecoil';
        fx.play(loserId, collapse);
        for (const o of order) timers.later(() => useDefeat.getState().seq?.key === key && fx.play(o.id, 'flinch'), 40 + Math.random() * 120);
      });
      when(at.impact + 320, () => sound.setMix({ music: 0, ambient: 0.12, sfx: 0.25 }, 0.5));
    }

    // ── 余波：烟雾散去、牌落下、房间安静；赢家与旁观者的余韵反应 ──
    if (at.aftermath !== undefined) {
      when(at.aftermath, () => {
        sound.setMix({ music: 0, ambient: 0.3, sfx: 0.35 }, 1.0);
        if (winnerId) {
          const w = seat(winnerId);
          if (w) {
            const r = WINNER_REACTION[winnerStyle(w)];
            fx.play(w.id, r.anim);
            fx.setMood(w.id, r.emoji, r.face, 2400);
          }
        }
        // 旁观者：有人笑、有人移开视线（交错，避免所有动物同时出声 / 同时动作）
        order
          .filter((o) => o.id !== winnerId)
          .forEach((o, i) =>
            timers.later(() => {
              if (useDefeat.getState().seq?.key !== key) return;
              const sp = species(o.id);
              const r = sp ? BYSTANDER_REACTION[sp] : null;
              if (r && r.anim !== 'stare') fx.play(o.id, r.anim);
            }, 500 + i * 260),
          );
      });
    }

    // ── 黑屏 → “出局” ──
    if (at.blackout !== undefined) when(at.blackout, () => sound.setMix({ music: 0, ambient: 0.15, sfx: 0.2 }, 0.6));
    if (at.defeated !== undefined) {
      when(at.defeated, () => {
        if (full) {
          sound.cineSting(0.05);
          useSettings.getState().set({ defeatSeen: true });
        } else {
          sound.setMix({ music: 0.6, ambient: 0.7, sfx: 0.8 }, 0.8);
        }
      });
    }

    // 简短版：到时间自动恢复（完整版等玩家在“出局”画面上选择）
    if (!full && at.recover !== undefined) {
      when(at.recover, () => {
        document.body.classList.remove('defeat-cine');
        sound.resetMix(0.6);
        useFx.getState().play(loserId, 'settle');
        timers.later(() => cleanup(false), 450);
      });
    }
  }
}
