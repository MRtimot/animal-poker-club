// 21 点事件导演：引擎 / 服务器的事件 → 筹码飞行、动物动作、镜头、灯光、音效、结果演出。
// 只负责表现：结果早已确定，演出可以随时跳过或打断，余额与胜负不变；离开牌桌 / 下一局开始时全部清理。
import { useEffect, useRef } from 'react';
import { DEALER_ID, type BjEvent, type BlackjackView } from '../../core/blackjack/types';
import { BJ_TIMING } from '../../core/blackjack/controller';
import type { Species } from '../../core/player/profile';
import { sound } from '../../audio/sound';
import { haptic } from '../../display/haptics';
import { useFx, type AnimName, type MoodFace } from '../../store/fxStore';
import { TABLE_Y, type V3 } from '../../three/layout';
import { DEALER_Z, TRAY_POS, computeBlackjackLayout, handBetPos, handCenter } from '../../three/blackjack/layout';
import { prefersReducedMotion } from '../../utils/reducedMotion';
import { DUR } from '../motion';
import { TimerBag } from '../timerBag';
import { CINE_TIMING, buildCine, outcomeOf, resetBjCine, useBjCine, type BjCine, type BjOutcome } from './cineStore';

type React = { anim: AnimName; face: MoodFace; emoji: string };
const R = (anim: AnimName, face: MoodFace, emoji: string): React => ({ anim, face, emoji });

/** 按动物性格的反应：赢 / 输 / 黑杰克 / 爆牌（同一套动作与表情，不同动物不一样） */
const REACTIONS: Record<'win' | 'lose' | 'natural' | 'bust', Partial<Record<Species, React>> & { default: React }> = {
  win: {
    default: R('happy', 'happy', '😊'),
    cat: R('smug', 'smug', '😏'),
    fox: R('smug', 'smug', '😼'),
    rabbit: R('surprised', 'wide', '😲'),
    tiger: R('cool', 'smug', '😎'),
    lion: R('cool', 'smug', '😎'),
    wolf: R('smug', 'smug', '😏'),
    monkey: R('laugh', 'happy', '🤣'),
    frog: R('laugh', 'happy', '😆'),
    panda: R('clap', 'happy', '😌'),
    bear: R('clap', 'happy', '😌'),
    penguin: R('settle', 'happy', '🙂'),
    dragon: R('smug', 'smug', '😏'),
  },
  lose: {
    default: R('sad', 'sad', '😞'),
    cat: R('lookAway', 'doubt', '😾'),
    fox: R('doubt', 'doubt', '🤨'),
    rabbit: R('nervous', 'wide', '😰'),
    tiger: R('angry', 'angry', '😤'),
    lion: R('angry', 'angry', '😤'),
    wolf: R('stare', 'doubt', '😑'),
    monkey: R('shock', 'wide', '🙈'),
    frog: R('shrug', 'doubt', '🤷'),
    penguin: R('shrug', 'normal', '😐'),
    dragon: R('stare', 'angry', '😒'),
  },
  natural: {
    default: R('win', 'happy', '🤩'),
    cat: R('smug', 'smug', '😼'),
    fox: R('smug', 'smug', '😏'),
    rabbit: R('shock', 'wide', '😱'),
    wolf: R('cool', 'smug', '😎'),
    tiger: R('cool', 'smug', '😎'),
    lion: R('cool', 'smug', '👑'),
    monkey: R('laugh', 'happy', '🤣'),
  },
  bust: {
    default: R('shock', 'wide', '😣'),
    cat: R('lookAway', 'sad', '😿'),
    fox: R('doubt', 'doubt', '😒'),
    rabbit: R('nervous', 'sad', '😭'),
    tiger: R('angry', 'angry', '😠'),
    lion: R('angry', 'angry', '😠'),
    wolf: R('stare', 'doubt', '😑'),
    penguin: R('sad', 'sad', '😔'),
  },
};

const pickReaction = (k: keyof typeof REACTIONS, s: Species) => REACTIONS[k][s] ?? REACTIONS[k].default;

let skip: (() => void) | null = null;
/** 跳过结果演出（只跳过画面：结果、派彩、余额都不变） */
export function skipBjCine() {
  skip?.();
}

/** 演出结束 / 跳过 / 打断：声音、灯光、镜头恢复；筹码立即就位 */
function endCine(cineTimers: TimerBag, roundId: string | null) {
  cineTimers.cancelAll();
  sound.resetMix(0.6);
  const fx = useFx.getState();
  fx.setTension(0);
  if (fx.cue?.type === 'focus') fx.setCue(null);
  useBjCine.setState(roundId ? { cine: null, paidRound: roundId } : { cine: null });
}

/** 派彩：赢的筹码从庄家筹码盘飞来，输的筹码收走；所有玩家一起 */
function payout(v: BlackjackView | null, roundId: string, quick = false) {
  if (!v || v.roundId !== roundId) return;
  const fx = useFx.getState();
  const layout = computeBlackjackLayout(v);
  let k = 0;
  for (const p of v.players) {
    const l = layout.get(p.id);
    if (!l) continue;
    p.hands.forEach((h, hi) => {
      const bet = handBetPos(l, hi, p.hands.length);
      const delay = quick ? 0 : k++ * 120;
      if (h.payout > 0) {
        if (h.payout > h.bet) fx.flyChips({ from: TRAY_POS, to: bet, amount: h.payout - h.bet, duration: 700, delay, arc: 0.14 });
        fx.flyChips({ from: bet, to: l.stack, amount: h.payout, duration: DUR.chipFlight, delay: delay + (h.payout > h.bet ? 620 : 0) });
      } else fx.flyChips({ from: bet, to: TRAY_POS, amount: h.bet, duration: 720, delay, arc: 0.08 });
    });
  }
  useBjCine.setState({ paidRound: roundId });
}

export function useBlackjackDirector(view: BlackjackView | null) {
  const lastSeq = useRef<number | null>(null);
  const lastRound = useRef('');
  const timers = useRef(new TimerBag()).current;
  const cineTimers = useRef(new TimerBag()).current;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    skip = () => {
      const c = useBjCine.getState().cine;
      if (!c) return;
      const paid = useBjCine.getState().paidRound === c.roundId;
      endCine(cineTimers, c.roundId);
      if (!paid) payout(viewRef.current, c.roundId, true);
    };
    return () => {
      skip = null;
    };
  });

  // 卸载：不留下计时器、压低的音量或演出状态
  useEffect(
    () => () => {
      timers.cancelAll();
      endCine(cineTimers, null);
      resetBjCine();
    },
    [timers, cineTimers],
  );

  useEffect(() => {
    if (!view) {
      timers.cancelAll();
      if (useBjCine.getState().cine) endCine(cineTimers, null);
      resetBjCine();
      lastSeq.current = null;
      lastRound.current = '';
      return;
    }
    const events = view.events;
    const maxSeq = events.length ? events[events.length - 1].seq : 0;
    // 首次进入 / 重连：不回放；已经结算的局直接显示为派完
    if (lastSeq.current === null || maxSeq < lastSeq.current) {
      lastSeq.current = maxSeq;
      lastRound.current = view.roundId;
      if (view.phase === 'round-end') useBjCine.setState({ cine: null, paidRound: view.roundId });
      return;
    }
    const fresh = events.filter((e) => e.seq > (lastSeq.current ?? 0));
    if (!fresh.length) return;
    lastSeq.current = maxSeq;
    if (view.roundId !== lastRound.current) {
      // 下一局已经开始：上一局还没播完的演出立刻收尾（在线时服务器不会等任何人的画面）
      lastRound.current = view.roundId;
      timers.cancelAll();
      if (useBjCine.getState().cine) endCine(cineTimers, null);
      resetBjCine();
    }

    const fx = useFx.getState();
    const layout = computeBlackjackLayout(view);
    const viewer = view.viewerId;
    const seat = (id: string) => view.players.find((p) => p.id === id);
    const species = (id: string): Species => (id === DEALER_ID ? view.dealer.profile.animal.species : (seat(id)?.profile.animal.species ?? 'cat'));
    const react = (id: string, k: keyof typeof REACTIONS, ms = 2200) => {
      const r = pickReaction(k, species(id));
      fx.play(id, r.anim);
      fx.setMood(id, r.emoji, r.face, ms);
    };
    const betSpot = (id: string, handId?: string): V3 | null => {
      const l = layout.get(id);
      const p = seat(id);
      if (!l || !p) return null;
      const hi = Math.max(0, p.hands.findIndex((h) => h.id === handId));
      return handBetPos(l, hi, Math.max(1, p.hands.length));
    };
    const focusHand = (id: string, amt: number, ms: number) => {
      const l = layout.get(id);
      if (!l) return;
      const c = handCenter(l);
      fx.setCue({ type: 'focus', duration: ms, focus: { eye: [c[0] * 0.9, 4.4, c[2] + 3.2], look: [c[0], TABLE_Y, c[2] - 0.3], amt } });
    };
    const focusDealer = (amt: number, ms: number) => fx.setCue({ type: 'focus', duration: ms, focus: { eye: [0, 3.9, 3.1], look: [0, 1.5, DEALER_Z - 0.9], amt } });
    // 发牌批次里的事件（黑杰克）要等牌都落桌
    const dealMs = fresh.filter((e) => e.type === 'card' && e.kind === 'deal').length * BJ_TIMING.card;
    const landed = DUR.cardFlight + DUR.cardFlip + 120;

    for (const e of fresh) handleEvent(e);

    function handleEvent(e: BjEvent) {
      switch (e.type) {
        case 'shuffle':
          sound.play('shuffle');
          fx.play(DEALER_ID, 'gatherCards');
          break;
        case 'roundStart':
          if (e.round > 1) fx.play(DEALER_ID, 'gatherCards');
          break;
        case 'bet': {
          const l = layout.get(e.playerId);
          const to = betSpot(e.playerId);
          if (l && to) fx.flyChips({ from: l.stack, to, amount: e.amount, duration: DUR.chipFlight - 120 });
          fx.play(e.playerId, 'bet');
          break;
        }
        case 'card':
          if (e.kind === 'deal' && e.index === 0 && e.to === DEALER_ID) fx.play(DEALER_ID, 'stackChips');
          break;
        case 'turn':
          if (e.playerId === viewer) {
            sound.play('turn');
            haptic('tap');
            focusHand(viewer, 0.22, 1600);
          }
          break;
        case 'hit':
          sound.play('check', 0, pan(e.playerId));
          fx.play(e.playerId, 'talk');
          break;
        case 'stand':
          if (!e.auto) {
            sound.play('tick', 0, pan(e.playerId));
            fx.play(e.playerId, 'settle');
          }
          break;
        case 'double':
        case 'split': {
          const l = layout.get(e.playerId);
          const to = betSpot(e.playerId, e.type === 'split' ? e.newHandId : e.handId);
          if (l && to) fx.flyChips({ from: l.stack, to, amount: e.added, duration: DUR.chipFlight });
          fx.play(e.playerId, e.type === 'double' ? 'raise' : 'bet');
          if (e.type === 'double') {
            fx.boostLight(0.35, 1400);
            if (e.playerId === viewer) {
              focusHand(viewer, 0.34, 2200);
              haptic('action');
            }
          }
          break;
        }
        case 'blackjack':
          timers.later(() => {
            react(e.playerId, 'natural', 2600);
            const l = layout.get(e.playerId);
            if (l && !prefersReducedMotion()) fx.burst([handCenter(l)[0], TABLE_Y + 0.4, handCenter(l)[2]], 'sparkle');
            fx.setMood(DEALER_ID, '😯', 'wide', 1800);
            if (e.playerId === viewer) {
              sound.play('bjReveal');
              sound.duck(0.35, 2200);
              focusHand(viewer, 0.42, 2600);
              fx.boostLight(0.5, 2400);
              haptic('impact');
            }
          }, dealMs + landed - 300);
          break;
        case 'bust':
          timers.later(() => {
            react(e.playerId, 'bust');
            if (e.playerId === viewer) {
              sound.play('bjBust');
              sound.duck(0.3, 2000);
              focusHand(viewer, 0.34, 2000);
              fx.setTension(0.8);
              timers.later(() => fx.setTension(0), 1800);
              haptic('impact');
            }
          }, landed);
          break;
        case 'dealerReveal':
          fx.play(DEALER_ID, 'peek');
          focusDealer(0.3, 2600);
          fx.boostLight(0.25, 1600);
          timers.later(() => sound.play('bjReveal', 0, { x: 0, z: DEALER_Z }), DUR.cardFlip * 0.7);
          break;
        case 'dealerBlackjack':
          timers.later(() => {
            fx.play(DEALER_ID, 'smug');
            fx.setMood(DEALER_ID, '😏', 'smug', 2400);
          }, DUR.cardFlip + 200);
          break;
        case 'dealerBust':
          timers.later(() => react(DEALER_ID, 'bust'), landed);
          break;
        case 'dealerStand':
          sound.play('check', 0, { x: 0, z: DEALER_Z });
          fx.setMood(DEALER_ID, '🤚', 'normal', 1400);
          break;
        case 'resolved':
          startResult();
          break;
      }
    }

    function pan(id: string) {
      const l = layout.get(id);
      return l ? { x: l.cards[0], z: l.cards[2] } : undefined;
    }

    /** 结果演出：hush → verdict → payout。没有下注（旁观）的玩家只看派彩 */
    function startResult() {
      const v = view!;
      const cine = buildCine(v);
      const others = () => {
        for (const p of v.players) {
          if (p.id === viewer) continue;
          const o = outcomeOf(p);
          if (o && o.profit !== 0) react(p.id, o.profit > 0 ? 'win' : 'lose');
        }
      };
      const dealerMood = (profit: number) => {
        if (profit > 0) fx.setMood(DEALER_ID, '😒', 'doubt', 1800);
        else if (profit < 0) {
          fx.play(DEALER_ID, 'smug');
          fx.setMood(DEALER_ID, '😌', 'smug', 1800);
        }
      };
      cineTimers.cancelAll();
      if (!cine) {
        cineTimers.later(() => {
          payout(viewRef.current, v.roundId);
          others();
        }, 500);
        return;
      }
      const t = CINE_TIMING[cine.outcome];
      const auto = !prefersReducedMotion();
      useBjCine.setState({ cine });
      sound.setMix({ music: 0.28, ambient: 0.25, sfx: 1 }, 0.25);
      hush(cine, auto);
      cineTimers.later(() => {
        setPhase('verdict');
        verdict(cine, auto, dealerMood);
        others();
      }, t.hush);
      cineTimers.later(() => {
        setPhase('payout');
        payout(viewRef.current, v.roundId);
      }, t.hush + t.verdict);
      cineTimers.later(() => endCine(cineTimers, v.roundId), t.hush + t.verdict + t.payout);
    }

    function setPhase(phase: BjCine['phase']) {
      const c = useBjCine.getState().cine;
      if (c) useBjCine.setState({ cine: { ...c, phase } });
    }

    function hush(c: BjCine, motion: boolean) {
      const bad: BjOutcome[] = ['lose', 'dealer-blackjack', 'bust'];
      if (bad.includes(c.outcome)) fx.setTension(0.9);
      if (c.outcome === 'push') return;
      if (c.outcome === 'blackjack') focusHand(viewer, 0.5, 3600);
      else if (c.outcome === 'bust') focusHand(viewer, 0.34, 2400);
      else if (motion) focusDealer(c.outcome === 'win' ? 0.36 : 0.5, 2300);
    }

    function verdict(c: BjCine, motion: boolean, dealerMood: (p: number) => void) {
      const l = layout.get(viewer);
      const center: V3 = l ? [handCenter(l)[0], TABLE_Y + 0.5, handCenter(l)[2]] : [0, TABLE_Y + 0.5, 1.8];
      dealerMood(c.profit);
      switch (c.outcome) {
        case 'blackjack':
          sound.play('bjNatural');
          fx.boostLight(0.9, 2600);
          if (motion) {
            fx.burst(center, 'gold');
            timers.later(() => fx.burst(center, 'sparkle'), 350);
          }
          react(viewer, 'natural', 2800);
          haptic('impact');
          break;
        case 'win':
          sound.play('win');
          fx.boostLight(0.55, 2000);
          if (motion) fx.burst(center, 'sparkle');
          react(viewer, 'win');
          haptic('action');
          break;
        case 'push':
          sound.play('bjPush');
          fx.setMood(viewer, '🤝', 'normal', 1400);
          break;
        case 'bust':
          sound.play('lose');
          react(viewer, 'bust');
          break;
        default:
          sound.play('lose');
          react(viewer, 'lose');
      }
    }
  }, [view, timers, cineTimers]);
}
