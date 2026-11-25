// 游戏模式：同一个俱乐部、同一套房间与牌桌页面，不同的牌局规则。
// 新增模式时在这里登记，并提供自己的引擎与控制器（不要把规则塞进别的模式里）。

export type GameMode = 'texas-holdem' | 'blackjack-21';

export interface GameModeInfo {
  id: GameMode;
  name: string;
  en: string;
  /** 开始一局至少需要几名玩家（21 点是玩家对庄家，一个人也能玩） */
  minPlayers: number;
}

export const GAME_MODES: Record<GameMode, GameModeInfo> = {
  'texas-holdem': { id: 'texas-holdem', name: '德州扑克', en: "TEXAS HOLD'EM", minPlayers: 2 },
  'blackjack-21': { id: 'blackjack-21', name: '21 点', en: 'BLACKJACK 21', minPlayers: 1 },
};

export const DEFAULT_GAME_MODE: GameMode = 'texas-holdem';

export function isGameMode(x: unknown): x is GameMode {
  return x === 'texas-holdem' || x === 'blackjack-21';
}

/** 旧房间 / 旧客户端没有这个字段：当作德州扑克 */
export function gameModeOf(x: { gameMode?: unknown } | null | undefined): GameMode {
  return isGameMode(x?.gameMode) ? x.gameMode : DEFAULT_GAME_MODE;
}
