// 本地百家乐：在浏览器里运行与服务器同一套控制器（完全离线）。
// 游客的下注使用持久金币（profile）；登录玩家连不上服务器时只能打练习桌（table，不影响账号）。
// 本地离线模式不以防作弊为目标：牌局与存档都在玩家自己的设备上。在线房间由服务器裁决。
import { AI_NAMES, PERSONALITIES, type AIPersonality } from '../core/ai/ai';
import { BaccaratController, type BacSeatConfig } from '../core/baccarat/controller';
import { pickDealer, type DealerChoice } from '../core/character/dealers';
import { bacTierById } from '../core/baccarat/rules';
import { BAC_DEALER_ID, type BacCommand, type BacEconomy } from '../core/baccarat/types';
import type { DialogueRef } from '../core/character/dialogue';
import { randomAnimal } from '../core/player/profile';
import { pick, randomId } from '../core/utils/random';
import { settleGuestBaccarat } from '../progress/baccaratTracker';
import { useGame } from '../store/gameStore';
import { currentProfile, isAccountMode, useProfile } from '../store/profileStore';
import { LOCAL_PLAYER_ID } from './localHost';
import { claimLocalTable } from './localTable';

export interface LocalBaccaratSettings {
  dealer: DealerChoice;
  tier: string;
  /** 同桌的 AI 动物（0 ~ 3 位） */
  companions: AIPersonality[];
}

const PRACTICE_CHIPS = 1000;

let controller: BaccaratController | null = null;
let unsub: (() => void) | null = null;

function chat(from: string, name: string, text: string, kind: 'chat' | 'emote' | 'system', dialogue?: DialogueRef) {
  useGame.getState().addChat({ id: randomId(8), from, name, text, kind, time: Date.now(), ...(dialogue ? { dialogue } : {}) });
}

export function startLocalBaccarat(settings: LocalBaccaratSettings) {
  claimLocalTable(stopLocalBaccarat);
  stopLocalBaccarat();
  const me = currentProfile();
  const tier = bacTierById(settings.tier);
  const economy: BacEconomy = isAccountMode() ? 'table' : 'profile';
  const used = new Set<string>([me.name]);
  const seats: BacSeatConfig[] = [{ id: LOCAL_PLAYER_ID, profile: me, chips: economy === 'profile' ? useProfile.getState().chips : PRACTICE_CHIPS, isAI: false }];
  settings.companions.slice(0, 3).forEach((p, i) => {
    let name = AI_NAMES[p].find((n) => !used.has(n)) ?? PERSONALITIES[p].name;
    if (used.has(name)) name = `${name}${i + 2}`;
    used.add(name);
    seats.push({ id: 'ai' + i, profile: { name, animal: randomAnimal(Math.random, [PERSONALITIES[p].species]), level: 1 }, chips: tier.minBet * 40, isAI: true, aiPersonality: p });
  });
  const c = new BaccaratController(seats, {
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
      if (mine) settleGuestBaccarat(mine.facts, economy);
    },
    onChat: (id, text, dialogue) => {
      const name = id === BAC_DEALER_ID ? c.dealer.profile.name : c.getMeta(id)?.profile.name;
      if (name) chat(id, name, text, 'chat', dialogue);
    },
  };
  const g = useGame.getState();
  g.set({ mode: 'local', room: null, chat: [], playerId: LOCAL_PLAYER_ID, view: null, bj: null, bac: null });
  chat('system', '系统', `欢迎来到百家乐牌桌！${tier.name} ${tier.minBet}–${tier.maxBet}，庄家 ${c.dealer.profile.name}。闲 1:1 · 庄 1:1 抽 5% · 和 8:1${economy === 'table' ? '（练习桌：不影响账号筹码）' : ''}`, 'system');
  unsub = c.subscribe(() => {
    if (controller === c) useGame.getState().setBac(c.getView(LOCAL_PLAYER_ID));
  });
  useGame.getState().setBac(c.getView(LOCAL_PLAYER_ID));
  c.start();
}

/** 一局中途离开：结果在停止下注时已经确定，按真实结果结算一次（不能靠离开逃掉输的注） */
export function stopLocalBaccarat() {
  unsub?.();
  unsub = null;
  const c = controller;
  controller = null;
  if (!c) return;
  const facts = c.leaveFacts(LOCAL_PLAYER_ID);
  if (facts) settleGuestBaccarat(facts, c.getView(LOCAL_PLAYER_ID).economy);
  c.stop();
}

export function baccaratCommand(cmd: BacCommand, ref: { round: number }): string | null {
  if (!controller) return '牌局还没有开始';
  return controller.handle(LOCAL_PLAYER_ID, cmd, ref);
}

export function baccaratChat(text: string, kind: 'chat' | 'emote') {
  const me = currentProfile();
  chat(LOCAL_PLAYER_ID, me.name, text, kind);
  const c = controller;
  if (!c || kind !== 'emote' || Math.random() > 0.5) return;
  const ids = [BAC_DEALER_ID, ...c.engine.players.filter((p) => p.id !== LOCAL_PLAYER_ID).map((p) => p.id)];
  const who = pick(Math.random, ids);
  const name = who === BAC_DEALER_ID ? c.dealer.profile.name : (c.getMeta(who)?.profile.name ?? '');
  setTimeout(() => {
    if (controller === c) chat(who, name, pick(Math.random, ['😂', '😎', '🔥', '👏']), 'emote');
  }, 900);
}

/** 仅开发模式：强制下一局的结果（只在下注阶段有效，交换牌靴里牌的顺序，不改规则与结算） */
export async function debugForceBac(kind: 'player' | 'banker' | 'tie' | 'natural' | 'third'): Promise<string> {
  if (!import.meta.env.DEV || !controller) return '不可用';
  const c = controller;
  if (c.engine.phase !== 'betting') return '只能在下注阶段使用';
  const { rigBacNext } = await import('../core/baccarat/debug');
  const plans: Record<typeof kind, string[]> = {
    player: ['9s', '7d', 'Kc', 'Kh'],
    banker: ['7s', '9d', 'Kc', 'Kh'],
    tie: ['8s', '8d', 'Kc', 'Kh'],
    natural: ['4s', '2d', '5c', '3h'],
    third: ['2s', 'Kd', '3c', '3h', '6s', '7d'],
  };
  c.engine = rigBacNext(c.engine, plans[kind]);
  return `下一局：${kind}`;
}
