// 服务器数据库：使用 Node.js 内置 SQLite（node:sqlite），不依赖任何第三方数据库服务
// 结构按模块拆分为多张表，并带有版本化的结构迁移（升级游戏不会丢失存档）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';

// 通过 require 加载，避免打包 / 测试工具把 node:sqlite 当成普通模块处理
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export type DB = DatabaseSyncT;

/** 数据库结构迁移：只能追加，不能修改已经发布的迁移 */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER NOT NULL,
        data_version INTEGER NOT NULL DEFAULT 1,
        guest_migrated INTEGER NOT NULL DEFAULT 0
      );
      -- 外部身份绑定（Google 等）。内部玩家 ID 与外部身份分离
      CREATE TABLE auth_identities (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (provider, subject)
      );
      CREATE INDEX idx_identities_user ON auth_identities(user_id);
      -- 登录会话：只保存令牌的 SHA-256 摘要，数据库泄露也无法直接登录
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE TABLE login_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        avatar_url TEXT,
        animal TEXT NOT NULL,
        onboarded INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE player_progress (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        level INTEGER NOT NULL DEFAULT 1,
        experience INTEGER NOT NULL DEFAULT 0,
        virtual_chips INTEGER NOT NULL DEFAULT 0 CHECK (virtual_chips >= 0),
        last_daily_bonus TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      -- 已解锁内容：动物、装饰
      CREATE TABLE player_inventory (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, item_type, item_id)
      );
      CREATE TABLE player_characters (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        animal TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE TABLE player_achievements (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        achievement_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, achievement_id)
      );
      CREATE TABLE player_statistics (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        games_played INTEGER NOT NULL DEFAULT 0,
        games_won INTEGER NOT NULL DEFAULT 0,
        hands_played INTEGER NOT NULL DEFAULT 0,
        hands_won INTEGER NOT NULL DEFAULT 0,
        folds INTEGER NOT NULL DEFAULT 0,
        all_ins INTEGER NOT NULL DEFAULT 0,
        all_in_wins INTEGER NOT NULL DEFAULT 0,
        uncontested_wins INTEGER NOT NULL DEFAULT 0,
        online_hands INTEGER NOT NULL DEFAULT 0,
        biggest_pot INTEGER NOT NULL DEFAULT 0,
        biggest_profit INTEGER NOT NULL DEFAULT 0,
        best_hand INTEGER NOT NULL DEFAULT -1,
        total_bet INTEGER NOT NULL DEFAULT 0,
        total_winnings INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        species_wins TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE player_settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        settings TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      -- 每一场比赛的结算记录；(user_id, game_key) 唯一，保证同一场不会重复领奖
      CREATE TABLE game_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_key TEXT NOT NULL,
        mode TEXT NOT NULL,
        place INTEGER NOT NULL,
        players INTEGER NOT NULL,
        hands INTEGER NOT NULL,
        table_chips INTEGER NOT NULL,
        chips_before INTEGER NOT NULL,
        chips_after INTEGER NOT NULL,
        xp_earned INTEGER NOT NULL,
        level_before INTEGER NOT NULL,
        level_after INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (user_id, game_key)
      );
      CREATE INDEX idx_results_user ON game_results(user_id, created_at DESC);
      -- 已处理的牌局事件（每一手牌），防止重复结算
      CREATE TABLE processed_events (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, event_key)
      );
    `,
  },
  {
    // 21 点统计（JSON：字段由 normalizeBlackjack 校验，以后增加统计项不用再改表）
    version: 2,
    sql: `ALTER TABLE player_statistics ADD COLUMN blackjack TEXT NOT NULL DEFAULT '{}';`,
  },
];

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_meta').get() as { version: number } | undefined;
  let current = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_meta (version) VALUES (0)').run();
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    tx(db, () => {
      db.exec(m.sql);
      db.prepare('UPDATE schema_meta SET version = ?').run(m.version);
    });
    current = m.version;
  }
}

/** 事务：要么全部写入，要么全部回滚（XP、等级、成就、筹码保持一致） */
const depth = new WeakMap<DB, number>();
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  // 嵌套调用时直接并入外层事务
  if (d > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    depth.set(db, 0);
  }
}
