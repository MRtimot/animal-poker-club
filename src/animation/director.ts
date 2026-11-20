// 事件导演：把服务器 / 本地引擎产生的牌局事件转换为动物动作、筹码飞行、音效和镜头
import { useEffect, useRef } from 'react';
import type { TableView } from '../core/game/view';
import type { GameEvent } from '../core/table/types';
import { useFx, AnimName } from '../store/fxStore';
import { computeLayout, POT_POS, SeatLayout, V3 } from '../three/layout';
import { sound } from '../audio/sound';
import { useGame } from '../store/gameStore';
import { EMOTE_ANIM } from './animalAnimations';
import type { ChatMessage } from '../core/protocol';

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

function handPos(l: SeatLayout): V3 {
  // 动物手部大致位置（座位与桌边之间）
  const a = l.angle;
  return [Math.sin(a) * 3.3, 1.3, Math.cos(a) * 3.3];
}

export function useTableDirector(view: TableView | null) {
  const lastSeq = useRef<number | null>(null);
  const lastHand = useRef<number>(-1);
  const cursor = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  useEffect(() => {
    if (!view) return;
    const events = view.events;
    const maxSeq = events.length ? events[events.length - 1].seq : 0;

    // 首次进入 / 重连：不回放历史事件
    if (lastSeq.current === null || view.handNumber < lastHand.current || maxSeq < lastSeq.current) {
      lastSeq.current = maxSeq;
      lastHand.current = view.handNumber;
      return;
    }
    if (view.handNumber !== lastHand.current) {
      // 新的一手：事件序号在服务器端连续递增
      lastHand.current = view.handNumber;
    }
    const fresh = events.filter((e) => e.seq > (lastSeq.current ?? 0));
    if (!fresh.length) return;
    lastSeq.current = maxSeq;

    const layout = computeLayout(view);
    const fx = useFx.getState();
    const now = performance.now();
    cursor.current = Math.max(cursor.current, now);
    const viewer = view.viewerId;
    const name = (id: string) => view.players.find((p) => p.id === id);

    const at = (fn: () => void) => {
      const delay = Math.max(0, cursor.current - performance.now());
      if (delay < 5) fn();
      else timers.current.push(window.setTimeout(fn, delay));
    };
    const play = (id: string, a: AnimName) => fx.play(id, a);

    let showdownHappened = false;

    for (const e of fresh) {
      switch (e.type) {
        case 'handStart':
          at(() => sound.play('shuffle'));
          break;
        case 'blind': {
          const l = layout.get(e.playerId);
          if (l) at(() => fx.flyChips({ from: handPos(l), to: l.bet, amount: e.amount, duration: 380 }));
          break;
        }
        case 'turn':
          if (e.playerId === viewer) at(() => sound.play('turn'));
          break;
        case 'action': {
          const l = layout.get(e.playerId);
          const p = name(e.playerId);
          at(() => {
            if (e.action === 'fold') {
              play(e.playerId, 'fold');
              sound.play('fold');
            } else if (e.action === 'check') {
              sound.play('check');
              play(e.playerId, 'talk');
            } else if (e.action === 'call') {
              play(e.playerId, 'bet');
            } else if (e.action === 'raise') {
              play(e.playerId, 'raise');
              fx.setCue({ type: 'action', playerId: e.playerId, duration: 1500 });
            } else if (e.action === 'allin') {
              play(e.playerId, 'allin');
              sound.play('allin');
              fx.setCue({ type: 'allin', playerId: e.playerId, duration: 2200 });
              if (l) fx.burst(l.head, 'fire');
              if (p) sound.animal(p.profile.animal.species, 'neutral', 0.3);
            }
            if (l && e.added > 0) fx.flyChips({ from: handPos(l), to: l.bet, amount: e.added, duration: 420, delay: 180 });
          });
          break;
        }
        case 'collect':
          at(() => {
            e.amounts.forEach(({ playerId, amount }, i) => {
              const l = layout.get(playerId);
              if (l) fx.flyChips({ from: l.bet, to: POT_POS, amount, duration: 500, delay: i * 50 });
            });
          });
          break;
        case 'board':
          at(() => {
            // 动物们对公共牌的反应（纯表现）
            for (const p of view.players) {
              if (!p.inHand || p.folded || Math.random() > 0.22) continue;
              play(p.id, Math.random() < 0.5 ? 'nervous' : 'surprised');
            }
          });
          break;
        case 'showdown':
          showdownHappened = true;
          at(() => {
            fx.setCue({ type: 'showdown', duration: 2600 });
            for (const h of e.hands) play(h.playerId, 'surprised');
          });
          break;
        case 'refund': {
          const l = layout.get(e.playerId);
          if (l) at(() => fx.flyChips({ from: l.bet, to: handPos(l), amount: e.amount, duration: 500 }));
          break;
        }
        case 'win': {
          const winners = new Set(e.awards.map((a) => a.playerId));
          at(() => {
            let biggest = e.awards[0];
            e.awards.forEach((a, i) => {
              if (a.amount > (biggest?.amount ?? 0)) biggest = a;
              const l = layout.get(a.playerId);
              if (!l) return;
              fx.flyChips({ from: POT_POS, to: handPos(l), amount: a.amount, duration: 800, delay: i * 250 });
              play(a.playerId, e.uncontested ? 'happy' : 'win');
              if (!e.uncontested) fx.burst(l.head, 'confetti');
              else fx.burst(l.head, 'sparkle');
            });
            if (biggest && !e.uncontested) fx.setCue({ type: 'win', playerId: biggest.playerId, duration: 3200 });
            // 输家的反应
            if (!e.uncontested) {
              for (const p of view.players) {
                if (winners.has(p.id) || !p.inHand) continue;
                if (!p.folded) play(p.id, 'lose');
                else if (Math.random() < 0.3) play(p.id, 'sad');
              }
            }
            const viewerWon = winners.has(viewer);
            const me = name(viewer);
            if (viewerWon) {
              sound.play('win');
              if (me) sound.animal(me.profile.animal.species, 'happy', 0.4);
            } else if (me && me.inHand && !me.folded && showdownHappened) {
              sound.play('lose');
            } else {
              sound.play('chips', 0.2);
            }
          });
          break;
        }
      }
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
    for (const m of fresh) {
      if (m.kind === 'system') continue;
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
