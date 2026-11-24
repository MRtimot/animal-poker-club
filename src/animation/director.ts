// 事件导演：把服务器 / 本地引擎产生的牌局事件转换为动物动作、筹码飞行、音效和镜头
import { useEffect, useRef } from 'react';
import { TimerBag } from './timerBag';
import type { TableView } from '../core/game/view';
import type { GameEvent } from '../core/table/types';
import { useFx, AnimName, MoodFace } from '../store/fxStore';
import { DUR, STAGGER } from './motion';
import type { Card } from '../core/cards/card';
import type { Species } from '../core/player/profile';
import { evaluateHand, HandCategory } from '../core/poker/handEvaluator';
import { computeLayout, POT_POS, SeatLayout, V3 } from '../three/layout';
import { sound } from '../audio/sound';
import { dialogueAllowed, playDialogue } from './dialoguePlayback';
import { useGame } from '../store/gameStore';
import { EMOTE_ANIM } from './animalAnimations';
import type { ChatMessage } from '../core/protocol';
import { defeatVerdict } from './defeat/defeatRules';
import { defeatActive } from './defeat/defeatStore';

const GAP: Partial<Record<GameEvent['type'], number>> = {
  handStart: 200,
  blind: 140,
  action: 350,
  collect: 650,
  board: 250,
  showdown: 2600,
  refund: 300,
  win: 400,
};

/** 事件对应的动画从开始到“落地”的时间：用于让底池数字、牌局记录与画面同步 */
function landsAfter(e: GameEvent): number {
  switch (e.type) {
    case 'blind':
      return DUR.chipFlight - 120;
    case 'action':
      return e.added > 0 ? (e.action === 'allin' ? 380 : 220) + DUR.chipFlight : 120;
    case 'collect':
      return DUR.chipFlight;
    case 'board':
      return e.street === 'flop' ? 1300 : e.street === 'turn' ? 850 : 1350;
    case 'refund':
      return DUR.chipFlight;
    case 'win':
      return e.uncontested ? 150 + 950 : 1500;
    default:
      return 0;
  }
}

/** 玩家面前的筹码堆：下注从这里推出，赢得的筹码回到这里 */
function handPos(l: SeatLayout): V3 {
  return [l.stack[0], l.stack[1], l.stack[2]];
}

/** 别人全押时，各种动物的招牌反应 */
const ALLIN_REACTION: Partial<Record<Species, { emoji: string; face: MoodFace; anim: AnimName }>> = {
  panda: { emoji: '😳', face: 'wide', anim: 'surprised' },
  fox: { emoji: '🤨', face: 'doubt', anim: 'doubt' },
  rabbit: { emoji: '😱', face: 'wide', anim: 'shock' },
  cat: { emoji: '😏', face: 'smug', anim: 'smug' },
  frog: { emoji: '🤣', face: 'happy', anim: 'laugh' },
  bear: { emoji: '😳', face: 'wide', anim: 'surprised' },
  dog: { emoji: '😨', face: 'wide', anim: 'nervous' },
  monkey: { emoji: '🙈', face: 'wide', anim: 'nervous' },
  lion: { emoji: '😤', face: 'angry', anim: 'angry' },
  tiger: { emoji: '😤', face: 'angry', anim: 'angry' },
  wolf: { emoji: '🤨', face: 'doubt', anim: 'doubt' },
  penguin: { emoji: '😐', face: 'normal', anim: 'think' },
  koala: { emoji: '😪', face: 'normal', anim: 'nervous' },
  raccoon: { emoji: '🤨', face: 'doubt', anim: 'doubt' },
  dragon: { emoji: '😏', face: 'smug', anim: 'smug' },
};

/** 自己手牌的强弱（只看自己能看到的牌，不泄露任何对手信息） */
function myStrength(hole: (Card | null)[], board: Card[]): 'strong' | 'ok' | 'weak' | null {
  const cards = hole.filter((c): c is Card => !!c);
  if (cards.length < 2) return null;
  if (board.length >= 3) {
    const r = evaluateHand([...cards, ...board]);
    if (r.category >= HandCategory.TwoPair) return 'strong';
    if (r.category === HandCategory.OnePair) return 'ok';
    return 'weak';
  }
  const [a, b] = cards;
  if (a.rank === b.rank && a.rank >= 9) return 'strong';
  if (a.rank === b.rank || (a.rank >= 11 && b.rank >= 11) || (Math.max(a.rank, b.rank) === 14 && a.suit === b.suit)) return 'ok';
  if (Math.max(a.rank, b.rank) < 10 && a.suit !== b.suit && Math.abs(a.rank - b.rank) > 3) return 'weak';
  return null;
}

/**
 * 游戏状态动画控制器：服务器 / 本地引擎产生的牌局事件 → 动物动作、表情、筹码飞行、镜头、灯光、音效。
 * UI 不去猜状态，所有表现都由事件驱动，并按节奏依次播放。
 */
export function useTableDirector(view: TableView | null) {
  const lastSeq = useRef<number | null>(null);
  const lastHand = useRef<number>(-1);
  const cursor = useRef(0);
  // 待播放的表现（音效、动作、派奖、赢家演出）：到点后自动移除，离开牌桌时全部取消
  const timers = useRef(new TimerBag()).current;
  const cancelAll = () => timers.cancelAll();

  useEffect(() => cancelAll, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!view) {
      // 离开牌桌（返回首页 / 离开房间）：取消还没播放的音效与动画，下次进入牌桌重新开始，
      // 否则摊牌时离开，回到首页后还会听到“赢了”的音效、看到派奖动画
      cancelAll();
      lastSeq.current = null;
      lastHand.current = -1;
      cursor.current = 0;
      return;
    }
    const events = view.events;
    const maxSeq = events.length ? events[events.length - 1].seq : 0;

    // 首次进入 / 重连：不回放历史事件
    if (lastSeq.current === null || view.handNumber < lastHand.current || maxSeq < lastSeq.current) {
      lastSeq.current = maxSeq;
      lastHand.current = view.handNumber;
      useFx.getState().markShown(view.handNumber, maxSeq);
      return;
    }
    if (view.handNumber !== lastHand.current) lastHand.current = view.handNumber;
    const fresh = events.filter((e) => e.seq > (lastSeq.current ?? 0));
    if (!fresh.length) return;
    lastSeq.current = maxSeq;

    const layout = computeLayout(view);
    const fx = useFx.getState();
    const now = performance.now();
    cursor.current = Math.max(cursor.current, now);
    const viewer = view.viewerId;
    const seat = (id: string) => view.players.find((p) => p.id === id);
    const me = seat(viewer);

    const at = (fn: () => void, extra = 0) => {
      const delay = Math.max(0, cursor.current + extra - performance.now());
      if (delay < 5) fn();
      else timers.later(fn, delay);
    };
    const play = (id: string, a: AnimName) => fx.play(id, a);
    const mood = (id: string, emoji: string, face: MoodFace, ms?: number) => fx.setMood(id, emoji, face, ms);
    const active = () => view.players.filter((p) => p.inHand && !p.folded);

    /** 根据自己的牌决定表情（只影响自己的动物） */
    const reactToMyCards = (board: Card[]) => {
      if (!me || !me.inHand || me.folded) return;
      const s = myStrength(me.hole, board);
      if (s === 'strong') mood(viewer, '😏', 'smug', 2400);
      else if (s === 'weak') mood(viewer, '😐', 'normal', 1800);
    };

    let showdownHappened = false;

    for (const e of fresh) {
      switch (e.type) {
        case 'handStart':
          at(() => sound.play('shuffle'));
          break;
        case 'blind': {
          const l = layout.get(e.playerId);
          if (l) at(() => fx.flyChips({ from: handPos(l), to: l.bet, amount: e.amount, duration: DUR.chipFlight - 120 }));
          break;
        }
        case 'dealHole': {
          // 发完牌后：大家低头看一眼自己的牌
          const n = e.order.length;
          at(() => {
            view.players.forEach((p, i) => {
              if (!p.inHand) return;
              timers.later(() => play(p.id, 'peek'), 120 * i);
            });
            reactToMyCards([]);
          }, n * STAGGER.holeCard + 700);
          break;
        }
        case 'turn':
          if (e.playerId === viewer) at(() => sound.play('turn'));
          break;
        case 'action': {
          const l = layout.get(e.playerId);
          const p = seat(e.playerId);
          at(() => {
            // 下注：动物先看向筹码、伸手（动作），再把筹码推出去
            let chipDelay = 220;
            if (e.action === 'fold') {
              play(e.playerId, 'fold');
              sound.play('fold', 0.25, l ? { x: l.cards[0], z: l.cards[2] } : undefined);
              mood(e.playerId, '😮‍💨', 'sad', 1500);
            } else if (e.action === 'check') {
              sound.play('check', 0, l ? { x: l.cards[0], z: l.cards[2] } : undefined);
              play(e.playerId, 'talk');
            } else if (e.action === 'call') {
              play(e.playerId, 'bet');
            } else if (e.action === 'raise') {
              play(e.playerId, 'raise');
              fx.setCue({ type: 'action', playerId: e.playerId, duration: 1500 });
              // 被加注的玩家：有人惊讶，有人怀疑
              const others = active().filter((x) => x.id !== e.playerId);
              others.forEach((o, i) => {
                if (Math.random() > 0.45) return;
                const sur = Math.random() < 0.5;
                timers.later(() => {
                  mood(o.id, sur ? '😳' : '🤨', sur ? 'wide' : 'doubt', 1800);
                  if (!sur) play(o.id, 'doubt');
                }, 450 + i * 120);
              });
            } else if (e.action === 'allin') {
              // 全押：自信 → 镜头快速推进 → 推出所有筹码 → 桌面震动 →“全押！”→ 其他动物反应
              chipDelay = 380;
              play(e.playerId, 'allin');
              mood(e.playerId, '😎', 'smug', 3000);
              fx.setCool(e.playerId, 3000);
              sound.play('allin');
              fx.setCue({ type: 'allin', playerId: e.playerId, duration: 2400 });
              fx.boostLight(0.7, 2200);
              fx.shout('全押', 'allin');
              // 全押：环境声降低、音乐进入高强度
              sound.duck(0.45, 1600);
              sound.setIntensity(1, 9000);
              if (p) sound.animal(p.profile.animal.species, 'neutral', 0.3);
              timers.later(() => fx.doShake(0.022), chipDelay + DUR.chipFlight);
              const others = view.players.filter((x) => x.id !== e.playerId && x.inHand && !x.busted);
              others.forEach((o, i) => {
                const r = ALLIN_REACTION[o.profile.animal.species] ?? { emoji: '😳', face: 'wide' as MoodFace, anim: 'surprised' as AnimName };
                timers.later(() => {
                  mood(o.id, r.emoji, r.face, 2400);
                  play(o.id, r.anim);
                }, 900 + i * 140);
              });
            }
            if (l && e.added > 0) fx.flyChips({ from: handPos(l), to: l.bet, amount: e.added, duration: DUR.chipFlight, delay: chipDelay });
          });
          break;
        }
        case 'collect':
          at(() => {
            e.amounts.forEach(({ playerId, amount }, i) => {
              const l = layout.get(playerId);
              if (l) fx.flyChips({ from: l.bet, to: POT_POS, amount, duration: DUR.chipFlight, delay: i * STAGGER.chipCollect });
            });
          });
          break;
        case 'board': {
          const street = e.street;
          const board = view.board.slice(0, street === 'flop' ? 3 : street === 'turn' ? 4 : 5);
          at(() => {
            fx.setCue({ type: street === 'flop' ? 'flop' : street === 'turn' ? 'turn' : 'river', duration: street === 'river' ? 2300 : street === 'flop' ? 2000 : 1600 });
            fx.boostLight(street === 'river' ? 0.45 : 0.25, street === 'river' ? 2200 : 1500);
            if (street === 'river') sound.duck(0.35, 1800);
            fx.shout(street === 'flop' ? '翻牌' : street === 'turn' ? '转牌' : '河牌', 'street');
          });
          // 牌翻开后，动物们的反应
          const revealAt = street === 'flop' ? 1500 : street === 'turn' ? 1000 : 1500;
          at(() => {
            for (const p of active()) {
              if (p.id === viewer || Math.random() > 0.25) continue;
              play(p.id, Math.random() < 0.5 ? 'nervous' : 'doubt');
            }
            reactToMyCards(board);
          }, revealAt);
          break;
        }
        case 'showdown':
          showdownHappened = true;
          at(() => {
            fx.setCue({ type: 'showdown', duration: 2600 });
            sound.setIntensity(0.85, 5000);
            sound.duck(0.6, 2400);
            e.hands.forEach((h, i) => timers.later(() => play(h.playerId, i % 2 ? 'surprised' : 'doubt'), i * 180));
          });
          break;
        case 'refund': {
          const l = layout.get(e.playerId);
          if (l) at(() => fx.flyChips({ from: l.bet, to: handPos(l), amount: e.amount, duration: DUR.chipFlight }));
          break;
        }
        case 'win': {
          const winners = new Set(e.awards.map((a) => a.playerId));
          const tie = !e.uncontested && winners.size > 1;
          // 牌力等级 → 演出强度（高牌 / 一对很克制，皇家同花顺最隆重）
          let best = -1;
          for (const sh of view.summary?.shown ?? []) if (winners.has(sh.playerId)) best = Math.max(best, sh.category);
          const tier = e.uncontested ? -1 : best >= 9 ? 5 : best >= 8 ? 4 : best >= 7 ? 3 : best >= 4 ? 2 : best >= 2 ? 1 : 0;
          const bestName = view.summary?.shown.find((sh) => winners.has(sh.playerId) && sh.category === best)?.handName;
          // 自己输掉了关键一手：由失败演出接管自己的反应与声音（这里不再播放普通的“输了”动作和音效）
          const defeatPlanned = !!defeatVerdict(view, winners, e.uncontested);
          at(() => {
            let biggest = e.awards[0];
            for (const a of e.awards) if (a.amount > (biggest?.amount ?? 0)) biggest = a;
            // 1. 镜头移到赢家（平局时环绕桌面），灯光增强
            const cueMs = tier >= 5 ? 5200 : tier >= 3 ? 4200 : 3400;
            if (tie) {
              fx.setCue({ type: 'showdown', duration: 3000 });
              fx.shout('平局', 'tie');
            } else if (biggest && !e.uncontested) fx.setCue({ type: 'win', playerId: biggest.playerId, duration: cueMs });
            if (tier >= 3 && bestName) {
              fx.shout(bestName, 'hand');
              sound.duck(0.3, 2600);
            }
            if (tier >= 1) fx.boostLight(Math.min(1, 0.3 + tier * 0.15), 2000 + tier * 400);
            // 2. 短暂停顿后，筹码从底池移向赢家；赢家起身庆祝
            const payoutDelay = e.uncontested ? 150 : tier >= 3 ? 900 : 520;
            // 赢家演出（界面）：同一玩家的多个池合并；牌型与最佳五张来自引擎的摊牌结果
            const merged = new Map<string, number>();
            for (const a of e.awards) merged.set(a.playerId, (merged.get(a.playerId) ?? 0) + a.amount);
            const hand = view.handNumber;
            timers.later(() => {
              fx.present({
                hand,
                uncontested: e.uncontested,
                tie,
                winners: [...merged].map(([playerId, amount]) => {
                  const sh = view.summary?.shown.find((x) => x.playerId === playerId);
                  const handName = view.summary?.winners.find((w) => w.playerId === playerId && w.handName)?.handName ?? sh?.handName;
                  return { playerId, amount, handName: e.uncontested ? undefined : handName, cards: e.uncontested ? [] : sh?.bestCards ?? [] };
                }),
                duration: e.uncontested ? 2200 : tier >= 3 ? 4200 : 3400,
              });
            }, payoutDelay);
            e.awards.forEach((a, i) => {
              const l = layout.get(a.playerId);
              if (!l) return;
              fx.flyChips({ from: POT_POS, to: handPos(l), amount: a.amount, duration: 950, delay: payoutDelay + i * STAGGER.winnerPayout, arc: 0.12 });
              timers.later(() => {
                play(a.playerId, e.uncontested || tier <= 0 ? 'happy' : 'win');
                if (!e.uncontested) mood(a.playerId, tie ? '🤝' : '😆', 'happy', 2600);
                // 粒子：按牌力分级，始终克制
                if (tier >= 1) fx.burst(l.head, 'gold');
                if (tier >= 2) fx.burst(l.head, 'confetti');
                if (tier >= 5) timers.later(() => fx.burst(l.head, 'gold'), 600);
              }, payoutDelay + i * STAGGER.winnerPayout);
            });
            // 3. 输家：愣住 → 低头 → 叹气
            if (!e.uncontested) {
              for (const p of view.players) {
                if (winners.has(p.id) || !p.inHand) continue;
                if (!p.folded) {
                  if (p.id === viewer && defeatPlanned) continue;
                  timers.later(() => {
                    play(p.id, 'lose');
                    mood(p.id, '😨', 'wide', 1400);
                  }, payoutDelay + 200);
                } else if (Math.random() < 0.3) play(p.id, 'sad');
              }
            }
            // 4. 音乐释放紧张感
            sound.setIntensity(0);
            const viewerWon = winners.has(viewer);
            if (viewerWon) {
              timers.later(() => sound.play(tier >= 5 ? 'royal' : 'win'), payoutDelay);
              if (me) sound.animal(me.profile.animal.species, 'happy', 0.4 + payoutDelay / 1000);
            } else if (tier >= 5) {
              timers.later(() => sound.play('royal'), payoutDelay);
            } else if (me && me.inHand && !me.folded && showdownHappened && !defeatPlanned) {
              sound.play('lose');
            } else {
              const l = biggest ? layout.get(biggest.playerId) : undefined;
              sound.play('chips', 0.2, l ? { x: l.stack[0], z: l.stack[2] } : undefined);
            }
          });
          break;
        }
      }
      // 这个事件的画面演完（筹码落地 / 牌翻开 / 派奖到手）时，界面上的底池与牌局记录才更新到它
      const hand = view.handNumber;
      const seq = e.seq;
      at(() => fx.markShown(hand, seq), landsAfter(e));
      cursor.current += GAP[e.type] ?? 0;
    }
  }, [view]);
}

/** 聊天 / 表情 → 气泡与动物动作 */
export function useChatReactions(view: TableView | null) {
  const seen = useRef<string | null>(null);
  const chat = useGame((s) => s.chat);
  useEffect(() => {
    if (!chat.length) return;
    const last = chat[chat.length - 1];
    if (seen.current === null) {
      seen.current = last.id;
      return;
    }
    const idx = chat.findIndex((m) => m.id === seen.current);
    const fresh: ChatMessage[] = idx >= 0 ? chat.slice(idx + 1) : [last];
    seen.current = last.id;
    const fx = useFx.getState();
    const g = useGame.getState();
    for (const m of fresh) {
      if (m.kind === 'system') continue;
      // 角色台词：由服务器决定，所有客户端同步播放（本地语音 + 说话动画）
      if (m.dialogue) {
        // 失败演出进行中：保持安静（只是不在本机播放，不影响其他玩家）
        if (defeatActive()) continue;
        // 重连 / 收到历史记录时不重播旧台词
        const age = Date.now() + (g.mode === 'online' ? g.clockOffset : 0) - m.time;
        if (age > 6000 || !dialogueAllowed(m.dialogue)) continue;
        const seat = view?.players.find((p) => p.id === m.from);
        if (!seat) continue;
        void playDialogue(m.from, m.text, m.dialogue, seat.profile.animal, { name: m.name });
        continue;
      }
      fx.bubble(m.from, m.text, m.kind === 'emote' ? 'emote' : 'chat');
      sound.play('pop');
      if (m.kind === 'emote') {
        const a = EMOTE_ANIM[m.text];
        if (a) fx.play(m.from, a);
        if (m.text === '😎') fx.setCool(m.from, 3600);
        if (view) {
          const l = computeLayout(view).get(m.from);
          if (l && m.text === '❤️') fx.burst(l.head, 'hearts');
          if (l && m.text === '🔥') fx.burst(l.head, 'fire');
          if (l && (m.text === '👏' || m.text === '😂' || m.text === '🤣')) fx.burst(l.head, 'sparkle');
        }
      } else {
        fx.play(m.from, 'talk');
      }
    }
  }, [chat, view]);
}
