// 牌局界面的展示模型：只读取引擎给出的 TableView 与事件导演的“已演出”游标，
// 计算界面要显示的内容。这里不做任何扑克判断——谁赢、底池多少、轮到谁，全部来自引擎。
import type { SeatView, TableView } from '../../../core/game/view';
import type { GameEvent, LegalActions } from '../../../core/table/types';
import { ACTION_NAME } from '../../../core/table/types';
import { SPECIES_MAP } from '../../../core/player/profile';
import { rankLabel, SUIT_SYMBOL, type Card } from '../../../core/cards/card';
import { formatChips } from '../../../utils/format';

export interface Shown {
  hand: number;
  seq: number;
}

/** 当前这一手已经“演出”到的事件序号（导演还没播到的事件不显示，避免数字先变、筹码后到） */
function shownUpTo(view: Pick<TableView, 'handNumber'>, shown: Shown): number {
  // 演出进度未知（刚进入牌桌、特效被重置、画面重建）：直接以服务器状态为准
  if (shown.hand < 0) return Infinity;
  if (shown.hand === view.handNumber) return shown.seq;
  // 导演还停在上一手：这一手的事件一个都还没演出
  if (shown.hand < view.handNumber) return 0;
  // 新的一局（再来一局，从第 1 手重新开始）：以服务器状态为准
  return Infinity;
}

/**
 * 界面上显示的底池：随筹码飞行动画落地后才增加；派奖动画结束后归零。
 * 动画全部演完时与引擎的 potTotal 完全一致。
 */
export function presentedPot(view: Pick<TableView, 'handNumber' | 'events' | 'potTotal'>, shown: Shown): number {
  const upTo = shownUpTo(view, shown);
  const last = view.events.length ? view.events[view.events.length - 1].seq : 0;
  if (upTo >= last) return view.potTotal;
  let pot = 0;
  for (const e of view.events) {
    if (e.seq > upTo) break;
    if (e.type === 'blind') pot += e.amount;
    else if (e.type === 'action') pot += e.added;
    else if (e.type === 'refund') pot -= e.amount;
    else if (e.type === 'win') pot = 0;
  }
  return Math.max(0, pot);
}

export function speciesEmoji(p: Pick<SeatView, 'profile'>): string {
  return SPECIES_MAP[p.profile.animal.species]?.emoji ?? '🐾';
}

export function cardText(c: Card): string {
  return `${rankLabel(c.rank)}${SUIT_SYMBOL[c.suit]}`;
}

export interface FeedEntry {
  key: string;
  icon: string;
  text: string;
  tone: 'action' | 'raise' | 'fold' | 'street' | 'win' | 'blind';
}

/** 牌局记录（这一手发生了什么）：只包含已经演出的事件 */
export function feedEntries(view: TableView, shown: Shown, limit = 5): FeedEntry[] {
  const upTo = shownUpTo(view, shown);
  const seat = new Map(view.players.map((p) => [p.id, p]));
  const who = (id: string) => {
    const p = seat.get(id);
    if (!p) return { icon: '🐾', name: '玩家' };
    return { icon: speciesEmoji(p), name: id === view.viewerId ? '你' : p.name };
  };
  const out: FeedEntry[] = [];
  const push = (e: GameEvent, entry: Omit<FeedEntry, 'key'>) => out.push({ key: `${view.handNumber}-${e.seq}`, ...entry });
  // 这一街是否已经有人下注（翻牌前的盲注算作下注）：第一个“加注”其实是“下注”
  let streetBet = false;
  for (const e of view.events) {
    if (e.seq > upTo) break;
    if (e.type === 'blind') streetBet = true;
    else if (e.type === 'board') streetBet = false;
    switch (e.type) {
      case 'blind': {
        const w = who(e.playerId);
        push(e, { icon: w.icon, text: `${w.name} ${e.kind === 'sb' ? '小盲' : '大盲'} ${formatChips(e.amount)}`, tone: 'blind' });
        break;
      }
      case 'action': {
        const w = who(e.playerId);
        const name = ACTION_NAME[e.action];
        const opening = e.action === 'raise' && !streetBet;
        if (e.action === 'raise' || e.action === 'allin') streetBet = true;
        const text =
          e.action === 'raise'
            ? opening
              ? `${w.name} 下注 ${formatChips(e.betTo)}`
              : `${w.name} 加注到 ${formatChips(e.betTo)}`
            : e.action === 'call'
              ? `${w.name} 跟注 ${formatChips(e.added)}`
              : e.action === 'allin'
                ? `${w.name} 全押 ${formatChips(e.betTo)}`
                : `${w.name} ${name}`;
        push(e, { icon: w.icon, text, tone: e.action === 'fold' ? 'fold' : e.action === 'raise' || e.action === 'allin' ? 'raise' : 'action' });
        break;
      }
      case 'board': {
        const label = e.street === 'flop' ? '翻牌' : e.street === 'turn' ? '转牌' : '河牌';
        push(e, { icon: '🂠', text: `${label} ${e.cards.map(cardText).join(' ')}`, tone: 'street' });
        break;
      }
      case 'showdown':
        push(e, { icon: '👀', text: '摊牌', tone: 'street' });
        break;
      case 'win': {
        const merged = new Map<string, number>();
        for (const a of e.awards) merged.set(a.playerId, (merged.get(a.playerId) ?? 0) + a.amount);
        for (const [id, amount] of merged) {
          const w = who(id);
          const hand = e.uncontested ? '' : view.summary?.winners.find((x) => x.playerId === id && x.handName)?.handName;
          push(e, { icon: '🏆', text: `${w.name} 赢得 ${formatChips(amount)}${hand ? `（${hand}）` : ''}`, tone: 'win' });
        }
        break;
      }
    }
  }
  return out.slice(-limit);
}

/**
 * 座位状态文字（名牌上的一行）：思考中 / 弃牌 / 全押 / 跟注 120 …
 * left：玩家已经离开房间（不是暂时断线）——座位保留到本局结束只为筹码结算
 */
export function seatStatus(p: SeatView, view: Pick<TableView, 'currentPlayerId'>, left = false): { text: string; cls: string } {
  if (left && !p.isAI) return { text: '已离开', cls: 'out' };
  if (!p.connected && !p.isAI) return { text: '重新连接中…', cls: 'offline' };
  if (p.busted) return { text: '已出局', cls: 'out' };
  if (p.sittingOut) return { text: '暂时离开', cls: 'out' };
  if (view.currentPlayerId === p.id) return { text: '思考中…', cls: 'thinking' };
  if (p.folded) return { text: '已弃牌', cls: 'fold' };
  if (p.allIn) return { text: '全押', cls: 'allin' };
  const la = p.lastAction;
  if (la) {
    if (la.type === 'sb') return { text: `小盲 ${formatChips(la.amount)}`, cls: 'blind' };
    if (la.type === 'bb') return { text: `大盲 ${formatChips(la.amount)}`, cls: 'blind' };
    const name = ACTION_NAME[la.type];
    if (la.type === 'raise') return { text: `加注到 ${formatChips(la.amount)}`, cls: 'raise' };
    if (la.type === 'call') return { text: `跟注 ${formatChips(la.amount)}`, cls: 'call' };
    return { text: name, cls: la.type };
  }
  return { text: '', cls: '' };
}

/** 位置标记：庄家 / 小盲 / 大盲（跟随引擎给出的真实座位） */
export function positionBadges(view: Pick<TableView, 'dealerId' | 'sbId' | 'bbId' | 'phase'>, id: string): { key: 'd' | 'sb' | 'bb'; label: string }[] {
  const out: { key: 'd' | 'sb' | 'bb'; label: string }[] = [];
  if (view.dealerId === id) out.push({ key: 'd', label: '庄' });
  if (view.phase !== 'idle') {
    if (view.sbId === id) out.push({ key: 'sb', label: '小盲' });
    if (view.bbId === id) out.push({ key: 'bb', label: '大盲' });
  }
  return out;
}

export interface RaisePreset {
  label: string;
  to: number;
  allIn?: boolean;
}

/**
 * 加注快捷金额（全部是“加注到”的总额，并限制在引擎给出的最小 / 最大范围内）：
 * - 翻牌前无人加注：2× / 2.5× / 3× 大盲
 * - 已有人加注：2× / 2.5× / 3× 当前下注
 * - 翻牌后：⅓ / ½ / ¾ / 1× 底池（底池按“先跟注后的底池”计算）
 * - 最后一个永远是全押
 */
export function raisePresets(view: Pick<TableView, 'phase' | 'currentBet' | 'bigBlind' | 'potTotal'>, legal: LegalActions): RaisePreset[] {
  const out: RaisePreset[] = [];
  const add = (label: string, to: number) => {
    const v = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(to)));
    if (v >= legal.maxRaiseTo) return; // 等于全押的金额交给“全押”按钮
    if (!out.some((p) => p.to === v)) out.push({ label, to: v });
  };
  if (view.phase === 'preflop' || view.currentBet > 0) {
    const base = view.phase === 'preflop' && view.currentBet <= view.bigBlind ? view.bigBlind : view.currentBet;
    add('2×', base * 2);
    add('2.5×', base * 2.5);
    add('3×', base * 3);
  }
  if (view.phase !== 'preflop') {
    const potAfterCall = view.potTotal + legal.toCall;
    add('⅓ 底池', view.currentBet + potAfterCall / 3);
    add('½ 底池', view.currentBet + potAfterCall / 2);
    add('¾ 底池', view.currentBet + potAfterCall * 0.75);
    add('底池', view.currentBet + potAfterCall);
  }
  if (!out.length) add('最小', legal.minRaiseTo);
  out.push({ label: '全押', to: legal.maxRaiseTo, allIn: true });
  return out;
}

/** 加注滑块的步长：半个大盲，至少 1 */
export function raiseStep(bigBlind: number): number {
  return Math.max(1, Math.round(bigBlind / 2));
}

/** 把任意金额规整到合法范围，并对齐步长（最小 / 最大值本身总是允许，最大值即全押） */
export function snapRaise(amount: number, legal: Pick<LegalActions, 'minRaiseTo' | 'maxRaiseTo'>, step: number): number {
  if (!isFinite(amount)) return legal.minRaiseTo;
  if (amount >= legal.maxRaiseTo) return legal.maxRaiseTo;
  if (amount <= legal.minRaiseTo) return legal.minRaiseTo;
  const snapped = Math.round(amount / step) * step;
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, snapped));
}

/** 当前这一手是否已经演出到某类事件（例如摊牌） */
export function eventShown(view: Pick<TableView, 'handNumber' | 'events'>, shown: Shown, type: GameEvent['type']): boolean {
  const upTo = shownUpTo(view, shown);
  return view.events.some((e) => e.type === type && e.seq <= upTo);
}

/** 每位玩家面前“已经落地”的下注额（与筹码飞行动画同步）；全部演完时与引擎的 bet 一致 */
export function presentedBets(view: Pick<TableView, 'handNumber' | 'events' | 'players'>, shown: Shown): Map<string, number> {
  const upTo = shownUpTo(view, shown);
  const last = view.events.length ? view.events[view.events.length - 1].seq : 0;
  const out = new Map<string, number>();
  if (upTo >= last) {
    for (const p of view.players) if (p.bet > 0) out.set(p.id, p.bet);
    return out;
  }
  for (const e of view.events) {
    if (e.seq > upTo) break;
    if (e.type === 'blind') out.set(e.playerId, e.amount);
    else if (e.type === 'action') out.set(e.playerId, e.betTo);
    else if (e.type === 'refund') out.set(e.playerId, Math.max(0, (out.get(e.playerId) ?? 0) - e.amount));
    else if (e.type === 'collect' || e.type === 'win') out.clear();
  }
  for (const [k, v] of out) if (v <= 0) out.delete(k);
  return out;
}
