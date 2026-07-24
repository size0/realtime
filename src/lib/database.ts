import { existsSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

let databaseInstance: Database.Database | null = null;
let databasePath = "";

function configuredPath(): string {
  const configured = process.env.APP_DATABASE_FILE?.trim();
  if (configured) return configured;
  const legacy = process.env.APP_DATA_FILE?.trim();
  return legacy ? path.join(path.dirname(legacy), "app.sqlite") : ".data/app.sqlite";
}

function createSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      account_type TEXT NOT NULL CHECK (account_type IN ('managed', 'guest', 'wechat')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER,
      usage_realtime_connections INTEGER NOT NULL DEFAULT 0,
      usage_replies INTEGER NOT NULL DEFAULT 0,
      daily_usage_date TEXT NOT NULL,
      daily_realtime_connections INTEGER NOT NULL DEFAULT 0,
      daily_replies INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS oauth_identities (
      provider TEXT NOT NULL,
      subject_hash TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER NOT NULL,
      PRIMARY KEY (provider, subject_hash)
    );

    CREATE TABLE IF NOT EXISTS oauth_transactions (
      state_hash TEXT PRIMARY KEY,
      guest_user_id TEXT,
      return_to TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
      created_by TEXT,
      created_at INTEGER NOT NULL,
      published_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_voice TEXT NOT NULL CHECK (companion_voice IN ('breeze', 'glow', 'nightwatch')),
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'interrupted', 'failed')),
      risk_level TEXT NOT NULL DEFAULT 'normal' CHECK (risk_level IN ('normal', 'elevated', 'crisis')),
      prompt_version_id TEXT REFERENCES prompt_versions(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversations_user_created
      ON conversations(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      status TEXT NOT NULL CHECK (status IN ('streaming', 'complete', 'interrupted', 'failed')),
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_created
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS voice_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reserved_seconds INTEGER NOT NULL,
      used_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('active', 'closed', 'cancelled')),
      companion_voice TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS voice_sessions_user_started
      ON voice_sessions(user_id, started_at);

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      kind TEXT NOT NULL,
      quantity REAL NOT NULL,
      estimated_cost_cny REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_created ON admin_audit_logs(created_at DESC);
  `);
}

interface LegacyUser {
  id?: unknown;
  username?: unknown;
  displayName?: unknown;
  passwordHash?: unknown;
  passwordSalt?: unknown;
  role?: unknown;
  accountType?: unknown;
  enabled?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastLoginAt?: unknown;
  usage?: unknown;
  dailyUsage?: unknown;
}

function importLegacyUsers(db: Database.Database): void {
  if (db.prepare("SELECT value FROM app_meta WHERE key = ?").get("legacy_imported")) {
    return;
  }
  const legacyPath = process.env.APP_DATA_FILE?.trim();
  if (!legacyPath || !existsSync(legacyPath)) {
    db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES(?, ?)").run(
      "legacy_imported",
      "none",
    );
    return;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(legacyPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return;
    const users = (parsed as { users?: unknown }).users;
    if (!Array.isArray(users)) return;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO users (
        id, username, display_name, password_hash, password_salt, role,
        account_type, enabled, created_at, updated_at, last_login_at,
        usage_realtime_connections, usage_replies, daily_usage_date,
        daily_realtime_connections, daily_replies
      ) VALUES (
        @id, @username, @displayName, @passwordHash, @passwordSalt, @role,
        @accountType, @enabled, @createdAt, @updatedAt, @lastLoginAt,
        @connections, @replies, @dailyDate, @dailyConnections, @dailyReplies
      )
    `);
    const importAll = db.transaction((entries: unknown[]) => {
      for (const entry of entries) {
        if (typeof entry !== "object" || entry === null) continue;
        const user = entry as LegacyUser;
        if (
          typeof user.id !== "string" ||
          typeof user.username !== "string" ||
          typeof user.displayName !== "string" ||
          typeof user.passwordHash !== "string" ||
          typeof user.passwordSalt !== "string" ||
          (user.role !== "admin" && user.role !== "user")
        ) continue;
        const usage = typeof user.usage === "object" && user.usage !== null
          ? user.usage as Record<string, unknown>
          : {};
        const daily = typeof user.dailyUsage === "object" && user.dailyUsage !== null
          ? user.dailyUsage as Record<string, unknown>
          : {};
        const now = Date.now();
        insert.run({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          passwordHash: user.passwordHash,
          passwordSalt: user.passwordSalt,
          role: user.role,
          accountType:
            user.accountType === "guest" || user.accountType === "wechat"
              ? user.accountType
              : "managed",
          enabled: user.enabled === false ? 0 : 1,
          createdAt: typeof user.createdAt === "number" ? user.createdAt : now,
          updatedAt: typeof user.updatedAt === "number" ? user.updatedAt : now,
          lastLoginAt: typeof user.lastLoginAt === "number" ? user.lastLoginAt : null,
          connections:
            typeof usage.realtimeConnections === "number"
              ? usage.realtimeConnections
              : 0,
          replies: typeof usage.replies === "number" ? usage.replies : 0,
          dailyDate:
            typeof daily.date === "string"
              ? daily.date
              : new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
          dailyConnections:
            typeof daily.realtimeConnections === "number"
              ? daily.realtimeConnections
              : 0,
          dailyReplies: typeof daily.replies === "number" ? daily.replies : 0,
        });
      }
    });
    importAll(users);
    copyFileSync(legacyPath, `${legacyPath}.${Date.now()}.backup`);
    db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES(?, ?)").run(
      "legacy_imported",
      legacyPath,
    );
  } catch {
    // Keep the legacy file untouched. Auth bootstrap remains available.
  }
}

export function database(): Database.Database {
  const target = path.resolve(configuredPath());
  if (databaseInstance && databasePath === target) return databaseInstance;
  if (databaseInstance) databaseInstance.close();
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const db = new Database(target);
  createSchema(db);
  importLegacyUsers(db);
  databaseInstance = db;
  databasePath = target;
  return db;
}

export function resetDatabaseForTests(): void {
  databaseInstance?.close();
  databaseInstance = null;
  databasePath = "";
}
