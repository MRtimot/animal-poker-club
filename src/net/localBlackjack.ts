// 本地 21 点：在浏览器里运行与服务器同一套控制器（完全离线）。
// 游客的下注使用持久金币（profile）；登录玩家连不上服务器时只能打练习桌（table，不影响账号）。
// 本地离线模式不以防作弊为目标：牌局与存档都在玩家自己的设备上。在线房间由服务器裁决。
import { AI_NAMES, PERSONALITIES, type AIPersonality } from '../core/ai/ai';
import { BlackjackController, type BjSeatConfig } from '../core/blackjack/controller';
import { BlackjackEngine } from '../core/blackjack/engine';
import { Shoe } from '../core/blackjack/shoe';
import { pickDealer, type DealerChoice } from '../core/blackjack/dealers';
import { tierById } from '../core/blackjack/rules';
import { DEALER_ID, type BjCommand, type BjEconomy } from '../core/blackjack/types';
import type { DialogueRef } from '../core/character/dialogue';
import { randomAnimal } from '../core/player/profile';
import { pick, randomId } from '../core/utils/random';
import { settleGuestRound } from '../progress/blackjackTracker';
import { useGame } from '../store/gameStore';
import { currentProfile, isAccountMode, useProfile } from '../store/profileStore';
import { LOCAL_PLAYER_ID } from './localHost';
import { claimLocalTable } from './localTable';

export interface LocalBlackjackSettings {
  dealer: DealerChoice;
  tier: string;
  /** 同桌的 AI 动物（0 ~ 3 位） */
  companions: AIPersonality[];
}

/** 练习桌筹码 */
const PRACTICE_CHIPS = 1000;

let controller: BlackjackController | null = null;
let unsub: (() => void) | null = null;

function chat(from: string, name: string, text: string, kind: 'chat' | 'emote' | 'system', dialogue?: DialogueRef) {
  useGame.getState().addChat({ id: randomId(8), from, name, text, kind, time: Date.now(), ...(dialogue ? { dialogue } : {}) });
}

export function startLocalBlackjack(settings: LocalBlackjackSettings) {
  claimLocalTable(stopLocalBlackjack);
  stopLocalBlackjack();
  const me = currentProfile();
  const tier = tierById(settings.tier);
  const economy: BjEconomy = isAccountMode() ? 'table' : 'profile';
  const used = new Set<string>([me.name]);
  const seats: BjSeatConfig[] = [{ id: LOCAL_PLAYER_ID, profile: me, chips: economy === 'profile' ? useProfile.getState().chips : PRACTICE_CHIPS, isAI: false }];
  settings.companions.slice(0, 3).forEach((p, i) => {
    let name = AI_NAMES[p].find((n) => !used.has(n)) ?? PERSONALITIES[p].name;
    if (used.has(name)) name = `${name}${i + 2}`;
    used.add(name);
    seats.push({ id: 'ai' + i, profile: { name, animal: randomAnimal(Math.random, [PERSONALITIES[p].species]), level: 1 }, chips: tier.minBet * 40, isAI: true, aiPersonality: p });
  });
  const c = new BlackjackController(seats, {
    solo: true,
    economy,
    startingChips: economy === 'profile' ? tier.minBet * 40 : PRACTICE_CHIPS,
    rules: { minBet: tier.minBet, maxBet: tier.maxBet },
    dealer: pickDealer(settings.dealer, Math.random),
  });
  controller = c;
  c.hooks = {
    balanceOf: (id) => (economy === 'profile' && id === LOCAL_PLAYER_ID ? useProfile.getState().chips : null),
    refill: (id) => (economy === 'profile' && id === LOCAL_PLAYER_ID ? useProfile.getState().refillChips(tier.minBet) : PRACTICE_CHIPS),
    refillsLeft: (id) => (economy === 'profile' && id === LOCAL_PLAYER_ID ? useProfile.getState().refillsLeft() : null),
    onRound: (results) => {
      const mine = results.find((r) => r.playerId === LOCAL_PLAYER_ID);
      if (mine) settleGuestRound(mine.facts, economy);
    },
    onChat: (id, text, dialogue) => {
      const name = id === DEALER_ID ? c.dealer.profile.name : c.getMeta(id)?.profile.name;
      if (name) chat(id, name, text, 'chat', dialogue);
    },
  };
  const g = useGame.getState();
  g.set({ mode: 'local', room: null, chat: [], playerId: LOCAL_PLAYER_ID, view: null, bj: null, bac: null });
  chat('system', '系统', `欢迎来到 21 点牌桌！${tier.name} ${tier.minBet}–${tier.maxBet}，庄家 ${c.dealer.profile.name}${economy === 'table' ? '（练习桌：不影响账号筹码）' : ''}`, 'system');
  unsub = c.subscribe(() => {
    if (controller === c) useGame.getState().setBj(c.getView(LOCAL_PLAYER_ID));
  });
  useGame.getState().setBj(c.getView(LOCAL_PLAYER_ID));
  c.start();
}

/** 一局中途离开：放弃这一局，下注按输掉结算（与在线离桌相同；不能靠离开逃掉输的牌） */
function forfeitIfPlaying(c: BlackjackController) {
  const facts = c.forfeitFacts(LOCAL_PLAYER_ID);
  if (facts) settleGuestRound(facts, c.getView(LOCAL_PLAYER_ID).economy);
}

export function stopLocalBlackjack() {
  unsub?.();
  unsub = null;
  const c = controller;
  controller = null;
  if (!c) return;
  forfeitIfPlaying(c);
  c.stop();
}

export function blackjackCommand(cmd: BjCommand, ref: { round: number; token: number }): string | null {
  if (!controller) return '牌局还没有开始';
  return controller.handle(LOCAL_PLAYER_ID, cmd, ref);
}

export function blackjackChat(text: string, kind: 'chat' | 'emote') {
  const me = currentProfile();
  chat(LOCAL_PLAYER_ID, me.name, text, kind);
  const c = controller;
  if (!c || kind !== 'emote' || Math.random() > 0.5) return;
  // 庄家 / 同桌动物偶尔回一个表情
  const ids = [DEALER_ID, ...c.engine.players.filter((p) => p.id !== LOCAL_PLAYER_ID).map((p) => p.id)];
  const who = pick(Math.random, ids);
  const name = who === DEALER_ID ? c.dealer.profile.name : (c.getMeta(who)?.profile.name ?? '');
  setTimeout(() => {
    if (controller === c) chat(who, name, pick(Math.random, ['😂', '😎', '🔥', '👏']), 'emote');
  }, 900);
}

/** 仅开发模式：强制这一局的结果（只在下注阶段有效，交换牌靴里的牌，不改规则与结算） */
export async function debugForce(kind: import('../core/blackjack/debug').ForcedOutcome): Promise<string> {
  if (!import.meta.env.DEV || !controller) return '不可用';
  const c = controller;
  if (c.engine.phase !== 'betting') return '只能在下注阶段使用';
  const { forceOutcome } = await import('../core/blackjack/debug');
  const s = c.engine.toState();
  // 自己坐第一个位置；同桌 AI 已经下注，所以按“下注人数”计算发牌位置
  const players = s.players.filter((p) => p.bet > 0 || p.id === LOCAL_PLAYER_ID).length;
  // 先换一副新牌靴：要用的牌一定都在
  c.engine = BlackjackEngine.fromState({ ...s, shoe: forceOutcome(new Shoe().toState(), kind, 0, players) });
  return `下一手：${kind}`;
}
