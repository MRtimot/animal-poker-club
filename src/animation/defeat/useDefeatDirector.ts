// 失败演出导演：读取真实的牌局结果（服务器 / 本地引擎的 win 事件与座位筹码），在自己输掉关键一手时
// 按时间表推进演出阶段，并在每个阶段触发一次性的动作、声音与反应。
// · 演出从“赢家演出”出现的那一刻开始（与事件导演的节奏完全对齐），不提前剧透、不延后牌局
// · 只控制画面、声音与动画：不修改、不同步任何牌局 / 房间 / 玩家状态（在线时每个客户端只演自己的失败）
// · 任何打断（离开牌桌、断线、简短版遇到下一手开始、页面卸载）都会立刻清理：计时器、声音、动画、镜头、灯光
import { useEffect, useRef } from 'react';
import type { SeatView, TableView } from '../../core/game/view';
import { resolveVoiceProfile } from '../../core/character/voice';
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
  DECAP_CUT_MS,
  DREAD_FACE,
  EXECUTION_REACTION,
  HEADLESS_COLLAPSE,
  LAST_WORDS,
  PHASE_ORDER,
  REALIZE_BY_TEMPERAMENT,
  WINNER_REACTION,
  buildTimeline,
  defeatProfile,
  defeatTemperament,
  defeatVerdict,
  lookOrder,
  winnerStyle,
  type DefeatPhase,
} from './defeatRules';
import { CHAIR_LAND_S, beginDefeat, endDefeat, setDefeatPhase, useDefeat, type DefeatSequence } from './defeatStore';

/** 椅子反应更大的“重”动物（与入场动画的分类一致） */
const HEAVY_SPECIES = new Set(['panda', 'bear', 'koala', 'lion']);

/**
 * 出局处决前，输家最后一句很短的话（按动物性格）：字幕由画面层显示；声音使用现有的角色语音
 * （带优先级的队列，同一时间只有一个角色说话），遵守玩家的语音设置。只在本机播放，不发送任何消息。
 */
function lastWords(me: SeatView) {
  const line = LAST_WORDS[me.profile.animal.species];
  const s = useSettings.getState();
  if (!line || /^[…\s.]*$/.test(line.text) || !s.voiceEnabled || s.voiceVolume <= 0) return;
  const fx = useFx.getState();
  fx.speakStart(me.id, { emotion: line.emotion, until: performance.now() + 1400, voiced: false, rate: s.voiceRate });
  void voice
    .speak(line.text, resolveVoiceProfile(me.profile.animal), {
      emotion: line.emotion,
      priority: 3,
      volume: s.voiceVolume,
      rate: s.voiceRate,
      onStart: () => useFx.getState().speakUpdate(me.id, { start: performance.now(), voiced: true }),
      onEnd: () => useFx.getState().speakEnd(me.id),
    })
    .then((r) => {
      if (r !== 'spoken') useFx.getState().speakEnd(me.id);
    });
}

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
      if (s.cut === 'full') voice.stop();
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
        voice.stop();
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
    const loserSpecies = v.players.find((p) => p.id === loserId)?.profile.animal.species;
    for (const o of order) lookers[o.id] = (at.reaction ?? t0) + o.delay;
    // 完整版：赢家在自己的特写里就已经看向输家
    if (winnerId && at.winner !== undefined && lookers[winnerId] !== undefined) lookers[winnerId] = at.winner + 350;
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
      // 完整版（出局）：处决——头部飞向哪一侧（镜头也在那一侧）与最后一句话
      ...(verdict.cut === 'full' ? { decap: { side: Math.random() < 0.5 ? (1 as const) : (-1 as const), lastWords: loserSpecies ? LAST_WORDS[loserSpecies].text : '……' } } : {}),
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

    // ── 输家意识到输了：方式取决于性格（项目里每种动物的性格数据）；倒吸一口气、心跳开始 ──
    if (at.realize !== undefined) {
      when(at.realize, () => {
        document.body.classList.add('defeat-cine');
        const me = seat(loserId);
        const sp = me?.profile.animal.species;
        const r = REALIZE_BY_TEMPERAMENT[sp ? defeatTemperament(sp, me?.aiPersonality) : 'calm'];
        fx.play(loserId, r.anim);
        fx.setMood(loserId, r.emoji, r.face, full ? 1600 : 1000);
        sound.cineBreath('gasp');
        if (sp) sound.animal(sp, 'sad', 0.5, 'cine');
      });
      const span = (at.winner ?? at.reaction ?? at.realize + 1500) - at.realize;
      when(at.realize + span * 0.35, () => sound.cineHeartbeat(0.5));
      if (full) when(at.realize + span * 0.8, () => sound.cineHeartbeat(0.58));
    }

    // ── 赢家特写：按性格反应（看着输家） ──
    if (full && at.winner !== undefined && winnerId) {
      const w = seat(winnerId);
      when(at.winner, () => {
        if (!w) return;
        const r = WINNER_REACTION[winnerStyle(w)];
        fx.play(w.id, r.anim);
        fx.setMood(w.id, r.emoji, r.face, 2600);
        sound.animal(w.profile.animal.species, 'happy', 0.25, 'cine');
      });
      const span = (at.reaction ?? at.winner + 1200) - at.winner;
      when(at.winner + span * 0.5, () => sound.cineHeartbeat(0.64));
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
            if (r.anim === 'stare' || r.anim === 'lookAway' || r.anim === 'uneasy') fx.play(o.id, r.anim);
          }, full ? 420 : 200);
        });
      }
      const span = (at.tension ?? at.silence ?? at.reaction + 900) - at.reaction;
      const beats = full ? [0.15, 0.6, 0.95] : [0.2, 0.7];
      beats.forEach((k, i) => when(at.reaction! + span * k, () => sound.cineHeartbeat(0.7 + i * 0.08)));
      if (!full) when(at.reaction + span * 0.4, () => sound.setMix({ music: 0.15, ambient: 0.1, sfx: 0.12 }, 0.4));
    }

    // ── 过肩镜头：低频铺底、发抖的呼吸、心跳加快；输家一直绷着（表情保持到冲击） ──
    if (at.tension !== undefined) {
      when(at.tension, () => {
        const me = seat(loserId);
        const sp = me?.profile.animal.species;
        fx.play(loserId, 'dread');
        fx.setMood(loserId, '😰', DREAD_FACE[sp ? defeatTemperament(sp, me?.aiPersonality) : 'calm'], Math.max(500, (at.impact ?? at.tension! + 3000) - at.tension!));
        drone.current?.stop();
        drone.current = sound.cineDrone();
        sound.setMix({ music: 0.15, ambient: 0.12, sfx: 0.1 }, 0.5);
        sound.cineBreath('shaky', 0.15);
      });
      [0, 0.38, 0.72].forEach((k, i) => when(at.tension! + 1100 * k, () => sound.cineHeartbeat(0.9 + i * 0.06)));
    }

    // ── 极近特写：只剩心跳和呼吸（其他声音几乎听不到） ──
    if (at.ecu !== undefined) {
      when(at.ecu, () => {
        sound.setMix({ music: 0.07, ambient: 0.05, sfx: 0.04 }, 0.6);
        sound.cineBreath('inhale', 0.1);
        sound.cineBreath('shaky', 0.55);
      });
      const span = (at.insert ?? at.ecu + 1200) - at.ecu;
      [0.05, 0.34, 0.6, 0.84].forEach((k, i) => when(at.ecu! + span * k, () => sound.cineHeartbeat(1.0 + i * 0.05)));
    }

    // ── 环境特写：桌上的牌与筹码随心跳轻轻颤动；心跳最快，最后一声重心跳 ──
    if (at.insert !== undefined && at.silence !== undefined) {
      const span = at.silence - at.insert;
      [0, 0.42].forEach((k, i) => when(at.insert! + span * k, () => sound.cineHeartbeat(1.05 + i * 0.1)));
      when(at.silence - 70, () => {
        sound.cineHeartbeat(1.4);
        haptic('tap');
      });
    }

    // ── 出局处决：最后一句话 → 处决准备（心跳越来越响）；静止前最后一声重心跳 ──
    if (full && at.lastword !== undefined) {
      when(at.lastword, () => {
        const me = seat(loserId);
        sound.setMix({ music: 0.06, ambient: 0.05, sfx: 0.05 }, 0.5);
        sound.cineBreath('inhale', 0.05);
        if (me) lastWords(me);
      });
    }
    if (full && at.prep !== undefined) {
      when(at.prep, () => {
        sound.setMix({ music: 0.03, ambient: 0.04, sfx: 0.04 }, 0.8);
        sound.cineBreath('shaky', 0.2);
        // 处决者（赢家）冷冷地盯着输家
        if (winnerId) fx.play(winnerId, 'stare');
      });
      const span = (at.ecu ?? at.prep + 1200) - at.prep;
      [0, 0.3, 0.56, 0.8].forEach((k, i) => when(at.prep! + span * k, () => sound.cineHeartbeat(0.95 + i * 0.07)));
    }
    if (at.insert === undefined && at.silence !== undefined && at.ecu !== undefined) {
      when(at.silence - 70, () => {
        sound.cineHeartbeat(1.45);
        haptic('tap');
      });
    }

    // ── 静止：一切突然停止 ──
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
        const sp = species(loserId);
        if (full) {
          // 处决的一瞬间：破风 → 撞击 → 低频重击 → 房间混响；头部在 DECAP_CUT_MS 后脱离身体（DefeatFX）
          sound.cineExecution(DECAP_CUT_MS / 1000, 1);
          fx.doShake(profile.shake * 1.3);
          haptic('defeat');
          fx.speakEnd(loserId);
          timers.later(() => useDefeat.getState().seq?.key === key && fx.play(loserId, 'headlessJolt'), DECAP_CUT_MS);
        } else {
          sound.cineImpact(0.65);
          sound.cineRing(0.35);
          sound.play('chips', 0.45);
          fx.doShake(profile.shake);
          haptic('impact');
          fx.play(loserId, 'defeatRecoil');
        }
        sound.cineChair(CHAIR_LAND_S, !!sp && HEAVY_SPECIES.has(sp), full ? 1 : 0.5);
        for (const o of order) timers.later(() => useDefeat.getState().seq?.key === key && fx.play(o.id, 'flinch'), 40 + Math.random() * 120);
      });
      when(at.impact + 320, () => sound.setMix(full ? { music: 0, ambient: 0.05, sfx: 0.18 } : { music: 0, ambient: 0.12, sfx: 0.25 }, 0.5));
    }

    // ── 处决之后：失去头部的身体失去支撑、倒下（头部的掉落与落地声由 DefeatFX 按轨迹播放） ──
    if (full && at.collapse !== undefined) {
      when(at.collapse, () => {
        const sp = species(loserId);
        let anim: AnimName = sp ? HEADLESS_COLLAPSE[sp] : 'headlessTopple';
        // 侧倒的方向跟着头部飞去的一侧（镜头也在那一侧）：身体倒向镜头，不会被椅背挡住
        // （roll 为正时身体倒向座位的局部 -X，换算到世界坐标正好是 side = -1 的方向）
        if (anim === 'headlessTopple' && seq.decap?.side === 1) anim = 'headlessToppleR';
        fx.play(loserId, anim);
        sound.cineBodyFall(anim === 'headlessSlump', anim === 'headlessSlump' ? 0.85 : 0.95);
      });
    }

    // ── 余波：烟雾散去、牌落下、房间安静；赢家与旁观者的余韵反应 ──
    if (full && at.aftermath !== undefined) {
      // 出局处决的余波：死寂。没有音乐、没有人说话；几枚还在滚动的筹码，最后一枚倒下；所有动物按性格僵住
      when(at.aftermath, () => {
        sound.setMix({ music: 0, ambient: 0.06, sfx: 0.14 }, 0.8);
        sound.cineChipSettle(0.5);
        [winnerId, ...order.map((o) => o.id)]
          .filter((id, i, all): id is string => !!id && id !== loserId && all.indexOf(id) === i)
          .forEach((id, i) =>
            timers.later(() => {
              if (useDefeat.getState().seq?.key !== key) return;
              const sp = species(id);
              const r = sp ? EXECUTION_REACTION[sp] : null;
              if (!r) return;
              fx.play(id, r.anim);
              fx.setMood(id, '', r.face, 3200);
            }, 200 + i * 220),
          );
      });
    } else if (at.aftermath !== undefined) {
      // 简短版：音乐在余波里非常慢地回来一点点；输家慢慢呼出一口气
      when(at.aftermath + 900, () => sound.cineBreath('exhale'));
      when(at.aftermath, () => {
        sound.setMix({ music: 0.12, ambient: 0.3, sfx: 0.35 }, 1.6);
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
    // 黑屏：直接切黑，没有音乐、没有台词
    if (at.blackout !== undefined)
      when(at.blackout, () => {
        voice.stop();
        sound.setMix({ music: 0, ambient: 0.08, sfx: 0.12 }, 0.06);
      });
    if (at.defeated !== undefined) {
      when(at.defeated, () => {
        if (full) {
          sound.cineSting(0.05);
          // “出局”画面上音乐慢慢回来（很低）
          sound.setMix({ music: 0.3, ambient: 0.3, sfx: 0.4 }, 2.2);
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
