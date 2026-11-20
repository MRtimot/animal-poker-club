// 本地对战：在浏览器中运行同一套游戏控制器 + 本地 AI（完全离线）
import { GameController } from '../core/game/controller';
import { AI_LINES, AI_NAMES, PERSONALITIES, type AIDifficulty, type AIPersonality } from '../core/ai/ai';
import { randomAnimal } from '../core/player/profile';
import type { PlayerAction } from '../core/table/types';
import type { SeatConfig } from '../core/game/view';
import { randomId, pick } from '../core/utils/random';
import { useGame } from '../store/gameStore';
import { currentProfile } from '../store/profileStore';

export interface LocalGameSettings {
  opponents: { personality: AIPersonality; difficulty: AIDifficulty }[];
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
}

export const LOCAL_PLAYER_ID = 'me';

let controller: GameController | null = null;
let lastSettings: LocalGameSettings | null = null;
let unsub: (() => void) | null = null;

function chat(from: string, name: string, text: string, kind: 'chat' | 'emote' | 'system') {
  useGame.getState().addChat({ id: randomId(8), from, name, text, kind, time: Date.now() });
}

export function startLocalGame(settings: LocalGameSettings) {
  stopLocalGame();
  lastSettings = settings;
  const me = currentProfile();
  const used = new Set<string>([me.name]);
  const seats: SeatConfig[] = [{ id: LOCAL_PLAYER_ID, profile: me, chips: settings.startingChips, isAI: false }];
  settings.opponents.forEach((o, i) => {
    const names = AI_NAMES[o.personality];
    const name = names.find((n) => !used.has(n)) ?? `${PERSONALITIES[o.personality].name}${i + 1}`;
    used.add(name);
    seats.push({
      id: 'ai' + i,
      profile: { name, animal: randomAnimal(Math.random, [PERSONALITIES[o.personality].species]), level: 1 },
      chips: settings.startingChips,
      isAI: true,
      aiPersonality: o.personality,
      aiDifficulty: o.difficulty,
    });
  });
  const c = new GameController(seats, { smallBlind: settings.smallBlind, bigBlind: settings.bigBlind, turnTimeMs: 45000 });
  controller = c;
  c.onChat = (playerId, kind, text) => {
    const m = c.getMeta(playerId);
    if (m) chat(playerId, m.profile.name, text, kind);
  };
  const g = useGame.getState();
  g.set({ mode: 'local', room: null, chat: [], playerId: LOCAL_PLAYER_ID, view: null });
  chat('system', '系统', `欢迎来到动物扑克俱乐部！本局盲注 ${settings.smallBlind}/${settings.bigBlind}，祝你好运 🍀`, 'system');
  unsub = c.subscribe(() => {
    if (controller === c) useGame.getState().setView(c.getView(LOCAL_PLAYER_ID));
  });
  useGame.getState().setView(c.getView(LOCAL_PLAYER_ID));
  c.start();
}

export function restartLocalGame() {
  if (lastSettings) startLocalGame(lastSettings);
}

export function stopLocalGame() {
  unsub?.();
  unsub = null;
  controller?.stop();
  controller = null;
}

export function localAction(action: PlayerAction): string | null {
  if (!controller) return '游戏未开始';
  return controller.handleAction(LOCAL_PLAYER_ID, action);
}

export function localChat(text: string, kind: 'chat' | 'emote') {
  const me = currentProfile();
  chat(LOCAL_PLAYER_ID, me.name, text, kind);
  // AI 偶尔回应玩家的聊天
  const c = controller;
  if (!c) return;
  const ais = c.engine.players.filter((p) => c.getMeta(p.id)?.isAI && !p.sittingOut && p.chips > 0);
  if (!ais.length || Math.random() > 0.45) return;
  const who = pick(Math.random, ais);
  setTimeout(() => {
    if (controller !== c) return;
    const replies = kind === 'emote' ? ['😂', '😎', '🔥', '👏', '🤣'] : [...AI_LINES.call, ...AI_LINES.win.slice(0, 2), '哼～', '走着瞧！'];
    const r = pick(Math.random, replies);
    chat(who.id, who.name, r, kind === 'emote' || r.length <= 2 ? 'emote' : 'chat');
  }, 900 + Math.random() * 1500);
}

export function setLocalPaused(paused: boolean) {
  if (controller) controller.paused = paused;
}
