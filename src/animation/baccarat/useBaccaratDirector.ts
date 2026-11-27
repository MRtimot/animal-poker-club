// 百家乐事件导演：引擎 / 服务器的事件 → 筹码飞行、动物动作、镜头、灯光、音效、结果演出。
// 只负责表现：结果早已确定，演出可以随时跳过或打断，余额与胜负不变；按事件序号去重，同一事件不会播放两次。
import { defeatActive } from '../defeat/defeatStore';
import { useEffect, useRef } from 'react';
import { BAC_DEALER_ID, type BacEvent, type BaccaratView } from '../../core/baccarat/types';
import { BAC_SPOTS, betTotal } from '../../core/baccarat/rules';
import type { Species } from '../../core/player/profile';
import { sound } from '../../audio/sound';
import { haptic } from '../../display/haptics';
import { useFx, type AnimName, type MoodFace } from '../../store/fxStore';
import { TABLE_Y, type V3 } from '../../three/layout';
import { DEALER_Z, TRAY_POS, bacSpotPos, computeBaccaratLayout, handCenterOf } from '../../three/baccarat/layout';
import { prefersReducedMotion } from '../../utils/reducedMotion';
import { DUR } from '../motion';
import { TimerBag } from '../timerBag';
import { BAC_CINE_TIMING, buildBacCine, resetBacCine, useBacCine, type BacCine } from './cineStore';

type React = { anim: AnimName; face: MoodFace; emoji: string };
const R = (anim: AnimName, face: MoodFace, emoji: string): React => ({ anim, face, emoji });

/** 按动物性格的反应（同一套动作与表情，不同动物不一样） */
const REACTIONS: Record<'win' | 'lose' | 'tie', Partial<Record<Species, React>> & { default: React }> = {
  win: {
    default: R('happy', 'happy', '😊'),
    lion: R('cool', 'smug', '😎'),
    tiger: R('cool', 'smug', '😎'),
    fox: R('smug', 'smug', '😏'),
    cat: R('smug', 'smug', '😼'),
    rabbit: R('surprised', 'wide', '😲'),
    panda: R('clap', 'happy', '😌'),
    bear: R('clap', 'happy', '😌'),
    monkey: R('laugh', 'happy', '🤣'),
    wolf: R('smug', 'smug', '😏'),
  },
  lose: {
    default: R('sad', 'sad', '😞'),
    lion: R('stare', 'doubt', '😑'),
    tiger: R('angry', 'angry', '😤'),
    fox: R('doubt', 'doubt', '🤨'),
    cat: R('lookAway', 'doubt', '😾'),
    rabbit: R('nervous', 'wide', '😰'),
    panda: R('shrug', 'normal', '😐'),
    monkey: R('shock', 'wide', '🙈'),
    wolf: R('stare', 'doubt', '😑'),
  },
  tie: {
    default: R('surprised', 'wide', '😮'),
    monkey: R('laugh', 'happy', '🤩'),
    rabbit: R('shock', 'wide', '😱'),
    lion: R('cool', 'normal', '🤨'),
  },
};
const pickReaction = (k: keyof typeof REACTIONS, s: Species) => REACTIONS[k][s] ?? REACTIONS[k].default;

/** 演出结束 / 跳过 / 打断：声音、灯光、镜头恢复；筹码立即就位 */
function endCine(cineTimers: TimerBag, roundId: string | null) {
  cineTimers.cancelAll();
  // 失败演出正在进行：混音由失败演出控制（结束时它自己恢复），这里不能把音乐提前放回来
  if (!defeatActive()) sound.resetMix(0.6);
  const fx = useFx.getState();
  fx.setTension(0);
  if (fx.cue?.type === 'focus') fx.setCue(null);
  useBacCine.setState(roundId ? { cine: null, paidRound: roundId } : { cine: null });
}

/** 派彩：赢的筹码从庄家筹码盘飞来再回到玩家面前，退回的直接回来，输的收走；所有玩家一起 */
function payout(v: BaccaratView | null, roundId: string, quick = false) {
  if (!v || v.roundId !== roundId) return;
  const fx = useFx.getState();
  const layout = computeBaccaratLayout(v);
  let k = 0;
  for (const p of v.players) {
    const l = layout.get(p.id);
    if (!l || !p.returns) continue;
    for (const s of BAC_SPOTS) {
      const bet = p.bets[s];
      if (bet <= 0) continue;
      const spot = bacSpotPos(l, s);
      const back = p.returns[s];
      const delay = quick ? 0 : k++ * 110;
      if (back > bet) fx.flyChips({ from: TRAY_POS, to: spot, amount: back - bet, duration: 700, delay, arc: 0.14 });
      if (back > 0) fx.flyChips({ from: spot, to: l.stack, amount: back, duration: DUR.chipFlight, delay: delay + (back > bet ? 620 : 0) });
      else fx.flyChips({ from: spot, to: TRAY_POS, amount: bet, duration: 720, delay, arc: 0.08 });
    }
  }
  useBacCine.setState({ paidRound: roundId });
}

let skip: (() => void) | null = null;
/** 跳过结果演出（只跳过画面：结果、派彩、余额都不变） */
export function skipBacCine() {
  skip?.();
}

export function useBaccaratDirector(view: BaccaratView | null) {
  const lastSeq = useRef<number | null>(null);
  const lastRound = useRef('');
  const timers = useRef(new TimerBag()).current;
  const cineTimers = useRef(new TimerBag()).current;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    skip = () => {
      const c = useBacCine.getState().cine;
      if (!c) return;
      const paid = useBacCine.getState().paidRound === c.roundId;
      endCine(cineTimers, c.roundId);
      if (!paid) payout(viewRef.current, c.roundId, true);
    };
    return () => {
      skip = null;
    };
  });

  useEffect(
    () => () => {
      timers.cancelAll();
      endCine(cineTimers, null);
      resetBacCine();
    },
    [timers, cineTimers],
  );

  useEffect(() => {
    if (!view) {
      timers.cancelAll();
      if (useBacCine.getState().cine) endCine(cineTimers, null);
      resetBacCine();
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
      if (view.phase === 'round-end') useBacCine.setState({ cine: null, paidRound: view.roundId });
      return;
    }
    const fresh = events.filter((e) => e.seq > (lastSeq.current ?? 0));
    if (!fresh.length) return;
    lastSeq.current = maxSeq;
    if (view.roundId !== lastRound.current) {
      // 下一局已经开始：上一局还没播完的演出立刻收尾（在线时服务器不会等任何人的画面）
      lastRound.current = view.roundId;
      timers.cancelAll();
      if (useBacCine.getState().cine) endCine(cineTimers, null);
      resetBacCine();
    }

    const fx = useFx.getState();
    const layout = computeBaccaratLayout(view);
    const viewer = view.viewerId;
    const motion = !prefersReducedMotion();
    const seat = (id: string) => view.players.find((p) => p.id === id);
    const species = (id: string): Species => (id === BAC_DEALER_ID ? view.dealer.profile.animal.species : (seat(id)?.profile.animal.species ?? 'cat'));
    const react = (id: string, k: keyof typeof REACTIONS, ms = 2200) => {
      const r = pickReaction(k, species(id));
      fx.play(id, r.anim);
      fx.setMood(id, r.emoji, r.face, ms);
    };
    const focus = (side: 'player' | 'banker' | 'both', amt: number, ms: number) => {
      if (!motion) return;
      const c: V3 = side === 'both' ? [0, TABLE_Y, -0.5] : handCenterOf(side);
      fx.setCue({ type: 'focus', duration: ms, focus: { eye: [c[0] * 0.7, 4.6, c[2] + 3.6], look: [c[0], TABLE_Y, c[2] - 0.3], amt } });
    };

    for (const e of fresh) handle(e);

    function handle(e: BacEvent) {
      switch (e.type) {
        case 'shuffle':
          sound.play('shuffle');
          fx.play(BAC_DEALER_ID, 'gatherCards');
          break;
        case 'roundStart':
          if (e.round > 1) fx.play(BAC_DEALER_ID, 'gatherCards');
          break;
        case 'bet': {
          const l = layout.get(e.playerId);
          if (l)
            for (const s of BAC_SPOTS) {
              const amount = e.bets[s];
              if (amount > 0) fx.flyChips({ from: l.stack, to: bacSpotPos(l, s), amount, duration: DUR.chipFlight - 120 });
            }
          fx.play(e.playerId, 'bet');
          if (e.playerId === viewer) haptic('action');
          break;
        }
        case 'closed':
          sound.play('bacClose');
          fx.play(BAC_DEALER_ID, 'stackChips');
          fx.setTension(0.25);
          focus('both', 0.18, 2200);
          break;
        case 'card':
          if (e.third) {
            sound.play('bacThird');
            fx.setTension(0.55);
            focus(e.side, 0.32, 1800);
            fx.play(BAC_DEALER_ID, 'peek');
          }
          break;
        case 'natural':
          timers.later(() => {
            sound.play('bjReveal');
            fx.boostLight(0.45, 1600);
            fx.setMood(BAC_DEALER_ID, '😯', 'wide', 1600);
            if (motion && e.side !== 'both') fx.burst([handCenterOf(e.side)[0], TABLE_Y + 0.4, handCenterOf(e.side)[2]], 'sparkle');
          }, DUR.cardFlip);
          break;
        case 'rule':
          if (e.action === 'draw') fx.play(BAC_DEALER_ID, 'talk');
          break;
        case 'result':
          startResult();
          break;
      }
    }

    /** 结果演出：hush → verdict → payout */
    function startResult() {
      const v = view!;
      const cine = buildBacCine(v);
      cineTimers.cancelAll();
      if (!cine) return;
      const t = BAC_CINE_TIMING[cine.winner];
      useBacCine.setState({ cine });
      sound.setMix({ music: 0.3, ambient: 0.25, sfx: 1 }, 0.25);
      fx.setTension(cine.winner === 'tie' ? 0.6 : 0.35);
      focus(cine.winner === 'tie' ? 'both' : cine.winner, 0.36, t.hush + t.verdict);
      cineTimers.later(() => {
        setPhase('verdict');
        verdict(cine);
      }, t.hush);
      cineTimers.later(() => {
        setPhase('payout');
        payout(viewRef.current, v.roundId);
      }, t.hush + t.verdict);
      cineTimers.later(() => endCine(cineTimers, v.roundId), t.hush + t.verdict + t.payout);
    }

    function setPhase(phase: BacCine['phase']) {
      const c = useBacCine.getState().cine;
      if (c) useBacCine.setState({ cine: { ...c, phase } });
    }

    function verdict(c: BacCine) {
      const v = view!;
      fx.setTension(0);
      if (c.winner === 'tie') {
        sound.play('bacTie');
        fx.boostLight(0.5, 2000);
        react(BAC_DEALER_ID, 'tie');
      } else {
        sound.play('bjReveal', 0, { x: 0, z: DEALER_Z });
        fx.boostLight(0.35, 1600);
        if (motion) fx.burst([handCenterOf(c.winner)[0], TABLE_Y + 0.4, handCenterOf(c.winner)[2]], 'sparkle');
      }
      // 每个人按自己的净输赢反应；庄家对着桌面的大多数做表情
      let tableProfit = 0;
      for (const p of v.players) {
        if (!p.returns || p.left) continue;
        const profit = betTotal(p.returns) - betTotal(p.bets);
        tableProfit += profit;
        if (p.id === viewer) continue;
        if (profit !== 0) react(p.id, profit > 0 ? 'win' : 'lose');
      }
      if (c.winner !== 'tie') {
        if (tableProfit > 0) react(BAC_DEALER_ID, 'lose', 1800);
        else if (tableProfit < 0) react(BAC_DEALER_ID, 'win', 1800);
      }
      if (c.profit === null) return;
      if (c.profit > 0) {
        sound.play(c.winner === 'tie' ? 'bjNatural' : 'win');
        react(viewer, 'win', 2600);
        haptic('impact');
      } else if (c.profit < 0) {
        sound.play('lose');
        react(viewer, 'lose');
      } else {
        sound.play('bjPush');
        fx.setMood(viewer, '🤝', 'normal', 1400);
      }
    }
  }, [view, timers, cineTimers]);
}
