// 玩家账号服务：玩家档案、进度、收藏、成就、统计、设置。
// 服务器是唯一可信来源：经验、等级、筹码、成就、解锁内容只在这里计算和写入。
import { tx, type DB } from '../db/database';
import { randomId } from '../../src/core/utils/random';
import {
  DATA_VERSION,
  STARTING_CHIPS,
  cleanNickname,
  nicknameError,
  type AccountCharacter,
  type AccountSettings,
  type AccountState,
  type ProgressEvent,
} from '../../src/core/account/types';
import { DEFAULT_ANIMAL, NAME_IDEAS, SPECIES, sanitizeAnimal, sanitizeName, type AnimalConfig, type PlayerProfile, type Species } from '../../src/core/player/profile';
import { EMPTY_STATS, isSpeciesUnlocked, normalizeStats, xpForLevel, type RecentGame, type Stats } from '../../src/progress/progression';
import { REWARD, applyBlackjackRound, applyGame, applyHand, clampLevel, newAchievements, type GameFacts, type HandFacts } from '../../src/progress/rewards';
import { mergeGuestBlackjack } from '../../src/progress/blackjackStats';
import type { BjRoundFacts } from '../../src/core/blackjack/types';

export class AccountError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface IdentityInfo {
  provider: 'google' | 'dev';
  subject: string;
  name?: string;
  picture?: string;
}

/** 游客迁移上限：本地存档无法被服务器验证，因此只迁移有限的进度 */
export const GUEST_LIMITS = {
  maxXp: xpForLevel(10),
  maxHands: 5000,
  maxGames: 1000,
  maxPot: 1_000_000,
};

const STAT_COLS: [keyof Stats, string][] = [
  ['gamesPlayed', 'games_played'],
  ['gamesWon', 'games_won'],
  ['handsPlayed', 'hands_played'],
  ['handsWon', 'hands_won'],
  ['folds', 'folds'],
  ['allIns', 'all_ins'],
  ['allInWins', 'all_in_wins'],
  ['uncontestedWins', 'uncontested_wins'],
  ['onlineHands', 'online_hands'],
  ['biggestPot', 'biggest_pot'],
  ['biggestProfit', 'biggest_profit'],
  ['bestHand', 'best_hand'],
  ['totalBet', 'total_bet'],
  ['totalWinnings', 'total_winnings'],
  ['currentStreak', 'current_streak'],
  ['bestStreak', 'best_streak'],
];

const today = () => new Date().toISOString().slice(0, 10);

function safeJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** 只接受 Google 官方头像域名的 https 地址 */
export function cleanAvatarUrl(u: unknown): string | null {
  if (typeof u !== 'string' || u.length > 500) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return null;
    if (!/(^|\.)googleusercontent\.com$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function defaultNickname(raw?: string): string {
  if (raw) {
    const n = cleanNickname(raw).slice(0, 12).trim();
    if (!nicknameError(n)) return n;
  }
  return NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)] + Math.floor(100 + Math.random() * 900);
}

const SETTING_KEYS: Record<keyof AccountSettings, (v: unknown) => unknown> = {
  language: (v) => (v === 'zh-CN' ? v : undefined),
  quality: (v) => (['low', 'medium', 'high', 'ultra'].includes(v as string) ? v : undefined),
  autoQuality: (v) => (typeof v === 'boolean' ? v : undefined),
  room: (v) => (['casino', 'penthouse', 'cabin'].includes(v as string) ? v : undefined),
  musicVolume: (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : undefined),
  sfxVolume: (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : undefined),
  ambientVolume: (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : undefined),
  autoCamera: (v) => (typeof v === 'boolean' ? v : undefined),
  showFps: (v) => (typeof v === 'boolean' ? v : undefined),
  tutorialDone: (v) => (typeof v === 'boolean' ? v : undefined),
  reducedMotion: (v) => (typeof v === 'boolean' ? v : undefined),
};

export function cleanSettings(input: unknown): Partial<AccountSettings> {
  const out: any = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, check] of Object.entries(SETTING_KEYS)) {
    const v = check((input as any)[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export class AccountService {
  constructor(private db: DB) {}

  // ───────────── 身份 ─────────────

  /** 根据已验证的外部身份找到或创建玩家（内部 ID 由服务器生成，与 Google ID / 邮箱无关） */
  loginWithIdentity(id: IdentityInfo): { userId: string; isNew: boolean } {
    return tx(this.db, () => {
      const now = Date.now();
      const row = this.db.prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?').get(id.provider, id.subject) as
        | { user_id: string }
        | undefined;
      const avatar = cleanAvatarUrl(id.picture);
      if (row) {
        this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.user_id);
        if (avatar) this.db.prepare('UPDATE profiles SET avatar_url = ? WHERE user_id = ?').run(avatar, row.user_id);
        this.db.prepare('INSERT INTO login_events (user_id, provider, created_at) VALUES (?, ?, ?)').run(row.user_id, id.provider, now);
        this.migrateUserData(row.user_id);
        return { userId: row.user_id, isNew: false };
      }
      const userId = 'p_' + randomId(20);
      this.db.prepare('INSERT INTO users (id, created_at, last_login_at, data_version) VALUES (?, ?, ?, ?)').run(userId, now, now, DATA_VERSION);
      this.db.prepare('INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)').run(id.provider, id.subject, userId, now);
      this.db
        .prepare('INSERT INTO profiles (user_id, nickname, avatar_url, animal, onboarded, version, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?)')
        .run(userId, defaultNickname(id.name), avatar, JSON.stringify(DEFAULT_ANIMAL), now);
      this.db
        .prepare('INSERT INTO player_progress (user_id, level, experience, virtual_chips, version, updated_at) VALUES (?, 1, 0, ?, 1, ?)')
        .run(userId, STARTING_CHIPS, now);
      this.db.prepare('INSERT INTO player_statistics (user_id, updated_at) VALUES (?, ?)').run(userId, now);
      this.db.prepare('INSERT INTO player_settings (user_id, settings, version, updated_at) VALUES (?, ?, 1, ?)').run(userId, '{}', now);
      this.db.prepare('INSERT INTO login_events (user_id, provider, created_at) VALUES (?, ?, ?)').run(userId, id.provider, now);
      this.syncUnlocks(userId);
      return { userId, isNew: true };
    });
  }

  exists(userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
  }

  /** 玩家数据版本迁移：旧版本存档在登录时升级到当前结构 */
  private migrateUserData(userId: string) {
    const u = this.db.prepare('SELECT data_version FROM users WHERE id = ?').get(userId) as { data_version: number } | undefined;
    if (!u || u.data_version >= DATA_VERSION) return;
    let v = u.data_version;
    if (v < 2) {
      // v1 → v2：补齐已解锁动物（旧版本只按等级临时计算）
      this.syncUnlocks(userId);
      v = 2;
    }
    this.db.prepare('UPDATE users SET data_version = ? WHERE id = ?').run(v, userId);
  }

  // ───────────── 读取 ─────────────

  private readStats(userId: string): Stats {
    const r = this.db.prepare('SELECT * FROM player_statistics WHERE user_id = ?').get(userId) as any;
    if (!r) return { ...EMPTY_STATS, speciesWins: {} };
    const s: any = {};
    for (const [k, col] of STAT_COLS) s[k] = Number(r[col]);
    s.speciesWins = safeJson(r.species_wins, {});
    s.blackjack = safeJson(r.blackjack, {});
    return normalizeStats(s);
  }

  private writeStats(userId: string, s: Stats) {
    const sets = STAT_COLS.map(([, c]) => `${c} = ?`).join(', ');
    this.db
      .prepare(`UPDATE player_statistics SET ${sets}, species_wins = ?, blackjack = ?, updated_at = ? WHERE user_id = ?`)
      .run(...STAT_COLS.map(([k]) => Math.floor(Number(s[k]) || 0)), JSON.stringify(s.speciesWins), JSON.stringify(s.blackjack), Date.now(), userId);
  }

  private readAchievements(userId: string): Record<string, number> {
    const rows = this.db.prepare('SELECT achievement_id, unlocked_at FROM player_achievements WHERE user_id = ?').all(userId) as any[];
    return Object.fromEntries(rows.map((r) => [r.achievement_id, Number(r.unlocked_at)]));
  }

  private readProgress(userId: string) {
    const p = this.db.prepare('SELECT * FROM player_progress WHERE user_id = ?').get(userId) as any;
    if (!p) throw new AccountError(404, '玩家不存在');
    return { level: Number(p.level), xp: Number(p.experience), chips: Number(p.virtual_chips), daily: p.last_daily_bonus as string | null };
  }

  private unlockedAnimals(userId: string): Species[] {
    const rows = this.db.prepare("SELECT item_id FROM player_inventory WHERE user_id = ? AND item_type = 'animal'").all(userId) as any[];
    const have = new Set(rows.map((r) => r.item_id));
    return SPECIES.filter((s) => have.has(s.id)).map((s) => s.id);
  }

  /** 根据等级与成就写入新解锁的动物；返回本次新解锁的 */
  private syncUnlocks(userId: string): Species[] {
    const { level } = this.readProgress(userId);
    const ach = this.readAchievements(userId);
    const have = new Set(this.unlockedAnimals(userId));
    const fresh: Species[] = [];
    const ins = this.db.prepare("INSERT OR IGNORE INTO player_inventory (user_id, item_type, item_id, unlocked_at) VALUES (?, 'animal', ?, ?)");
    for (const s of SPECIES) {
      if (have.has(s.id) || !isSpeciesUnlocked(s.id, level, ach)) continue;
      ins.run(userId, s.id, Date.now());
      fresh.push(s.id);
    }
    return fresh;
  }

  getState(userId: string): AccountState {
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    const p = this.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) as any;
    if (!u || !p) throw new AccountError(404, '玩家不存在');
    const prog = this.readProgress(userId);
    const settings = this.db.prepare('SELECT settings FROM player_settings WHERE user_id = ?').get(userId) as any;
    const chars = this.db.prepare('SELECT * FROM player_characters WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[];
    const recent = this.db
      .prepare('SELECT * FROM game_results WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12')
      .all(userId) as any[];
    return {
      nickname: p.nickname,
      avatarUrl: p.avatar_url ?? null,
      onboarded: !!p.onboarded,
      createdAt: Number(u.created_at),
      animal: sanitizeAnimal(safeJson(p.animal, DEFAULT_ANIMAL)),
      characters: chars.map((c) => ({ id: c.id, name: c.name, animal: sanitizeAnimal(safeJson(c.animal, DEFAULT_ANIMAL)), createdAt: Number(c.created_at) })),
      level: prog.level,
      xp: prog.xp,
      chips: prog.chips,
      stats: this.readStats(userId),
      achievements: this.readAchievements(userId),
      unlockedAnimals: this.unlockedAnimals(userId),
      settings: cleanSettings(safeJson(settings?.settings, {})),
      recent: recent.map(
        (r): RecentGame => ({
          time: Number(r.created_at),
          mode: r.mode === 'online' ? 'online' : 'local',
          place: Number(r.place),
          players: Number(r.players),
          hands: Number(r.hands),
          chips: Number(r.table_chips),
        }),
      ),
      version: Number(p.version),
      dataVersion: Number(u.data_version),
    };
  }

  /** 牌桌上展示给其他玩家的公开资料 */
  publicProfile(userId: string): PlayerProfile & { avatar?: string } {
    const p = this.db.prepare('SELECT nickname, avatar_url, animal FROM profiles WHERE user_id = ?').get(userId) as any;
    const prog = this.readProgress(userId);
    return {
      name: p?.nickname ?? '神秘动物',
      animal: sanitizeAnimal(safeJson(p?.animal, DEFAULT_ANIMAL)),
      level: prog.level,
      ...(p?.avatar_url ? { avatar: p.avatar_url } : {}),
    };
  }

  // ───────────── 玩家可以修改的内容（只有外观类，不含任何进度） ─────────────

  private validCharacters(userId: string, list: unknown): AccountCharacter[] {
    if (!Array.isArray(list)) throw new AccountError(400, '角色列表格式错误');
    if (list.length > 12) throw new AccountError(400, '最多保存 12 个角色');
    const unlocked = new Set(this.unlockedAnimals(userId));
    const seen = new Set<string>();
    const out: AccountCharacter[] = [];
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      const id = String((c as any).id ?? '');
      if (!/^[A-Za-z0-9]{1,24}$/.test(id) || seen.has(id)) continue;
      const animal = sanitizeAnimal((c as any).animal);
      if (!unlocked.has(animal.species)) continue;
      seen.add(id);
      const createdAt = Number((c as any).createdAt);
      out.push({ id, name: sanitizeName((c as any).name), animal, createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.min(createdAt, Date.now()) : Date.now() });
    }
    return out;
  }

  /**
   * 修改玩家档案。只允许：昵称、当前动物外观、保存的角色、是否完成首次创建。
   * 任何其他字段（等级、筹码、经验、isAdmin…）一律拒绝。
   * baseVersion 与服务器版本不一致时返回冲突，由客户端在最新数据上重新应用。
   */
  updateProfile(userId: string, body: any, baseVersion?: number): AccountState {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AccountError(400, '请求格式错误');
    const allowed = new Set(['nickname', 'animal', 'characters', 'onboarded']);
    for (const k of Object.keys(body)) if (!allowed.has(k)) throw new AccountError(400, `不允许修改字段：${k}`);
    return tx(this.db, () => {
      const cur = this.db.prepare('SELECT version FROM profiles WHERE user_id = ?').get(userId) as any;
      if (!cur) throw new AccountError(404, '玩家不存在');
      if (baseVersion !== undefined && Number(cur.version) !== baseVersion) throw new AccountError(409, '资料已在其他设备上更新');
      const now = Date.now();
      if (body.nickname !== undefined) {
        const err = nicknameError(body.nickname);
        if (err) throw new AccountError(400, err);
        this.db.prepare('UPDATE profiles SET nickname = ? WHERE user_id = ?').run(cleanNickname(body.nickname), userId);
      }
      if (body.animal !== undefined) {
        const a: AnimalConfig = sanitizeAnimal(body.animal);
        if (!this.unlockedAnimals(userId).includes(a.species)) throw new AccountError(403, '这只动物还没有解锁');
        this.db.prepare('UPDATE profiles SET animal = ? WHERE user_id = ?').run(JSON.stringify(a), userId);
      }
      if (body.characters !== undefined) {
        const list = this.validCharacters(userId, body.characters);
        this.db.prepare('DELETE FROM player_characters WHERE user_id = ?').run(userId);
        const ins = this.db.prepare('INSERT INTO player_characters (user_id, id, name, animal, created_at) VALUES (?, ?, ?, ?, ?)');
        for (const c of list) ins.run(userId, c.id, c.name, JSON.stringify(c.animal), c.createdAt);
      }
      if (body.onboarded === true) this.db.prepare('UPDATE profiles SET onboarded = 1 WHERE user_id = ?').run(userId);
      this.db.prepare('UPDATE profiles SET version = version + 1, updated_at = ? WHERE user_id = ?').run(now, userId);
      return this.getState(userId);
    });
  }

  updateSettings(userId: string, body: unknown): AccountState {
    const patch = cleanSettings(body);
    return tx(this.db, () => {
      const r = this.db.prepare('SELECT settings FROM player_settings WHERE user_id = ?').get(userId) as any;
      const merged = { ...cleanSettings(safeJson(r?.settings, {})), ...patch };
      this.db
        .prepare('UPDATE player_settings SET settings = ?, version = version + 1, updated_at = ? WHERE user_id = ?')
        .run(JSON.stringify(merged), Date.now(), userId);
      return this.getState(userId);
    });
  }

  // ───────────── 游客存档迁移 ─────────────

  /**
   * 把游客本地存档合并进账号。本地数据无法验证，所以：
   * 每个账号只迁移一次；经验封顶 10 级；统计做一致性检查；成就由服务器根据统计重新判定。
   */
  migrateGuest(userId: string, raw: any): { state: AccountState; migrated: boolean } {
    return tx(this.db, () => {
      const u = this.db.prepare('SELECT guest_migrated FROM users WHERE id = ?').get(userId) as any;
      if (!u) throw new AccountError(404, '玩家不存在');
      if (u.guest_migrated) return { state: this.getState(userId), migrated: false };
      const g = raw && typeof raw === 'object' ? raw : {};
      const gs = normalizeStats(g.stats);
      const cap = (v: number, max: number) => Math.max(0, Math.min(max, Math.floor(v)));
      gs.handsPlayed = cap(gs.handsPlayed, GUEST_LIMITS.maxHands);
      gs.handsWon = cap(gs.handsWon, gs.handsPlayed);
      gs.gamesPlayed = cap(gs.gamesPlayed, GUEST_LIMITS.maxGames);
      gs.gamesWon = cap(gs.gamesWon, gs.gamesPlayed);
      gs.folds = cap(gs.folds, gs.handsPlayed);
      gs.allIns = cap(gs.allIns, gs.handsPlayed);
      gs.allInWins = cap(gs.allInWins, Math.min(gs.handsWon, gs.allIns || gs.handsWon));
      gs.uncontestedWins = cap(gs.uncontestedWins, gs.handsWon);
      gs.onlineHands = cap(gs.onlineHands, gs.handsPlayed);
      gs.biggestPot = cap(gs.biggestPot, GUEST_LIMITS.maxPot);
      gs.biggestProfit = cap(gs.biggestProfit, gs.biggestPot);
      gs.bestHand = gs.handsWon > 0 ? Math.max(-1, Math.min(9, gs.bestHand)) : -1;
      gs.totalBet = cap(gs.totalBet, GUEST_LIMITS.maxPot * 10);
      gs.totalWinnings = cap(gs.totalWinnings, GUEST_LIMITS.maxPot * 10);
      gs.bestStreak = cap(gs.bestStreak, gs.handsWon);
      gs.currentStreak = cap(gs.currentStreak, gs.bestStreak);
      let winsLeft = gs.handsWon;
      for (const sp of Object.keys(gs.speciesWins) as Species[]) {
        const v = cap(gs.speciesWins[sp] ?? 0, winsLeft);
        winsLeft -= v;
        if (v > 0) gs.speciesWins[sp] = v;
        else delete gs.speciesWins[sp];
      }
      const guestXp = cap(Number(g.xp) || 0, GUEST_LIMITS.maxXp);

      // 合并：计数累加，最佳值取较大者
      const cur = this.readStats(userId);
      const merged: Stats = { ...cur, speciesWins: { ...cur.speciesWins } };
      for (const k of ['gamesPlayed', 'gamesWon', 'handsPlayed', 'handsWon', 'folds', 'allIns', 'allInWins', 'uncontestedWins', 'onlineHands', 'totalBet', 'totalWinnings'] as const)
        merged[k] = cur[k] + gs[k];
      for (const k of ['biggestPot', 'biggestProfit', 'bestHand', 'bestStreak'] as const) merged[k] = Math.max(cur[k], gs[k]);
      for (const [sp, v] of Object.entries(gs.speciesWins)) merged.speciesWins[sp as Species] = (merged.speciesWins[sp as Species] ?? 0) + (v ?? 0);
      merged.blackjack = mergeGuestBlackjack(cur.blackjack, gs.blackjack, { rounds: GUEST_LIMITS.maxHands, chips: GUEST_LIMITS.maxPot });
      this.writeStats(userId, merged);
      this.applyRewards(userId, guestXp, 0, merged);

      // 外观：新账号沿用游客的昵称、动物与角色
      const prof = this.db.prepare('SELECT onboarded FROM profiles WHERE user_id = ?').get(userId) as any;
      const unlocked = new Set(this.unlockedAnimals(userId));
      if (!prof.onboarded) {
        if (typeof g.name === 'string' && !nicknameError(g.name)) this.db.prepare('UPDATE profiles SET nickname = ? WHERE user_id = ?').run(cleanNickname(g.name), userId);
        const a = sanitizeAnimal(g.animal);
        if (unlocked.has(a.species)) this.db.prepare('UPDATE profiles SET animal = ? WHERE user_id = ?').run(JSON.stringify(a), userId);
      }
      if (Array.isArray(g.characters) && g.characters.length) {
        const existing = this.getState(userId).characters;
        const ids = new Set(existing.map((c) => c.id));
        const list = this.validCharacters(userId, [...existing, ...g.characters.filter((c: any) => c && !ids.has(String(c.id)))].slice(0, 12));
        this.db.prepare('DELETE FROM player_characters WHERE user_id = ?').run(userId);
        const ins = this.db.prepare('INSERT INTO player_characters (user_id, id, name, animal, created_at) VALUES (?, ?, ?, ?, ?)');
        for (const c of list) ins.run(userId, c.id, c.name, JSON.stringify(c.animal), c.createdAt);
      }
      const settingsRow = this.db.prepare('SELECT settings FROM player_settings WHERE user_id = ?').get(userId) as any;
      if (Object.keys(cleanSettings(safeJson(settingsRow?.settings, {}))).length === 0 && g.settings) {
        this.db.prepare('UPDATE player_settings SET settings = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(cleanSettings(g.settings)), Date.now(), userId);
      }
      this.db.prepare('UPDATE users SET guest_migrated = 1 WHERE id = ?').run(userId);
      this.db.prepare('UPDATE profiles SET version = version + 1, updated_at = ? WHERE user_id = ?').run(Date.now(), userId);
      return { state: this.getState(userId), migrated: true };
    });
  }

  // ───────────── 结算（只由服务器的牌桌调用） ─────────────

  /** 写入统计、经验、筹码，并在同一事务中判定成就、升级与解锁 */
  private applyRewards(userId: string, xpGain: number, chipsGain: number, stats: Stats, tableDelta = 0): ProgressEvent {
    const before = this.readProgress(userId);
    const have = this.readAchievements(userId);
    const fresh = newAchievements(stats, have);
    const now = Date.now();
    const insA = this.db.prepare('INSERT OR IGNORE INTO player_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)');
    for (const id of fresh) insA.run(userId, id, now);
    const xp = Math.max(0, Math.floor(xpGain)) + fresh.length * REWARD.xp.achievement;
    const chips = Math.max(0, Math.floor(chipsGain)) + fresh.length * REWARD.chips.achievement;
    const newXp = before.xp + xp;
    const newLevel = Math.max(before.level, clampLevel(newXp));
    this.db
      .prepare('UPDATE player_progress SET experience = ?, level = ?, virtual_chips = MAX(0, virtual_chips + ?), version = version + 1, updated_at = ? WHERE user_id = ?')
      .run(newXp, newLevel, chips + Math.trunc(tableDelta), now, userId);
    this.writeStats(userId, stats);
    const newAnimals = this.syncUnlocks(userId);
    return { xpGained: xp, chipsGained: chips, levelBefore: before.level, levelAfter: newLevel, newAchievements: fresh, newAnimals };
  }

  /** 一手牌结束。eventKey 唯一，同一手牌重复调用不会重复发奖 */
  recordHand(userId: string, eventKey: string, f: HandFacts): ProgressEvent | null {
    return tx(this.db, () => {
      if (!this.exists(userId)) return null;
      const ins = this.db.prepare('INSERT OR IGNORE INTO processed_events (user_id, event_key, created_at) VALUES (?, ?, ?)').run(userId, eventKey, Date.now());
      if (Number(ins.changes) === 0) return null;
      const { stats, xp } = applyHand(this.readStats(userId), f);
      return this.applyRewards(userId, xp, 0, stats);
    });
  }

  /** 一整场结束。gameKey 唯一，同一场重复提交不会重复领奖 */
  recordGame(userId: string, gameKey: string, f: GameFacts): ProgressEvent | null {
    return tx(this.db, () => {
      if (!this.exists(userId)) return null;
      const dup = this.db.prepare('SELECT 1 FROM game_results WHERE user_id = ? AND game_key = ?').get(userId, gameKey);
      if (dup) return null;
      const before = this.readProgress(userId);
      const dailyFirst = before.daily !== today();
      const { stats, xp, chips } = applyGame(this.readStats(userId), f, dailyFirst);
      const ev = this.applyRewards(userId, xp, chips, stats);
      if (dailyFirst) this.db.prepare('UPDATE player_progress SET last_daily_bonus = ? WHERE user_id = ?').run(today(), userId);
      const after = this.readProgress(userId);
      this.db
        .prepare(
          `INSERT INTO game_results (user_id, game_key, mode, place, players, hands, table_chips, chips_before, chips_after, xp_earned, level_before, level_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, gameKey, f.mode, f.place, f.players, f.hands, f.finalChips, before.chips, after.chips, ev.xpGained, before.level, after.level, Date.now());
      return ev;
    });
  }

  /**
   * 一局 21 点结束。eventKey 唯一，同一局重复调用不会重复发奖、也不会重复增减筹码。
   * useWallet：单人桌押的是账号的虚拟筹码（多人房间用桌上筹码，不影响账号）
   */
  recordBlackjack(userId: string, eventKey: string, f: BjRoundFacts, useWallet: boolean): ProgressEvent | null {
    return tx(this.db, () => {
      if (!this.exists(userId)) return null;
      const ins = this.db.prepare('INSERT OR IGNORE INTO processed_events (user_id, event_key, created_at) VALUES (?, ?, ?)').run(userId, eventKey, Date.now());
      if (Number(ins.changes) === 0) return null;
      const { stats, xp } = applyBlackjackRound(this.readStats(userId), f);
      return this.applyRewards(userId, xp, 0, stats, useWallet ? f.profit : 0);
    });
  }

  /** 虚拟筹码余额 */
  chipsOf(userId: string): number {
    return this.readProgress(userId).chips;
  }

  /** 虚拟筹码低于 below 时补给到 amount；还够时不变。返回现在的数额 */
  refillChips(userId: string, below: number, amount: number): number {
    return tx(this.db, () => {
      const { chips } = this.readProgress(userId);
      if (chips >= below) return chips;
      this.db.prepare('UPDATE player_progress SET virtual_chips = ?, version = version + 1, updated_at = ? WHERE user_id = ?').run(amount, Date.now(), userId);
      return amount;
    });
  }

  // ───────────── 删除账号 ─────────────

  /** 删除玩家及其所有游戏数据（外键级联删除所有子表与登录会话） */
  deleteAccount(userId: string) {
    tx(this.db, () => {
      this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });
  }
}
