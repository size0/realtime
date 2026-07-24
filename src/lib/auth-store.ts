import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import { database, resetDatabaseForTests } from "@/lib/database";
import { getProductSettings } from "@/lib/product-admin";

const scrypt = promisify(scryptCallback);
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

export type UserRole = "admin" | "user";
export type AccountType = "managed" | "guest" | "wechat";
export type UsageKind = "realtimeConnections" | "replies";

export interface DailyUsage extends Record<UsageKind, number> {
  date: string;
}

export interface VoiceAllowance {
  limitSeconds: number | null;
  usedSeconds: number;
  remainingSeconds: number | null;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  role: UserRole;
  account_type: AccountType;
  enabled: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
  usage_realtime_connections: number;
  usage_replies: number;
  daily_usage_date: string;
  daily_realtime_connections: number;
  daily_replies: number;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  accountType: AccountType;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  usage: Record<UsageKind, number>;
  dailyUsage: DailyUsage;
}

export class AuthStoreError extends Error {
  constructor(
    public readonly code:
      | "INVALID_USERNAME"
      | "INVALID_PASSWORD"
      | "INVALID_DISPLAY_NAME"
      | "USER_EXISTS"
      | "USER_NOT_FOUND"
      | "MISSING_ADMIN_PASSWORD",
    message: string,
  ) {
    super(message);
    this.name = "AuthStoreError";
  }
}

let operationQueue: Promise<void> = Promise.resolve();
let adminBootstrap: Promise<void> | null = null;

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function chinaDateKey(now = Date.now()): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateUsername(username: string): string {
  const normalized = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new AuthStoreError(
      "INVALID_USERNAME",
      "用户名需为 3 到 32 位字母、数字、点、横线或下划线。",
    );
  }
  return normalized;
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new AuthStoreError("INVALID_PASSWORD", "密码长度需为 10 到 128 位。");
  }
}

function validateDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized || normalized.length > 40) {
    throw new AuthStoreError("INVALID_DISPLAY_NAME", "显示名称需为 1 到 40 个字符。");
  }
  return normalized;
}

async function passwordDigest(password: string, salt: string): Promise<Buffer> {
  return (await scrypt(password, salt, 64)) as Buffer;
}

async function newUser(input: {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
  accountType: AccountType;
}): Promise<UserRow> {
  const username = validateUsername(input.username);
  const displayName = validateDisplayName(input.displayName);
  validatePassword(input.password);
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = (await passwordDigest(input.password, passwordSalt)).toString("hex");
  const now = Date.now();
  return {
    id: randomUUID(),
    username,
    display_name: displayName,
    password_hash: passwordHash,
    password_salt: passwordSalt,
    role: input.role,
    account_type: input.accountType,
    enabled: 1,
    created_at: now,
    updated_at: now,
    last_login_at: null,
    usage_realtime_connections: 0,
    usage_replies: 0,
    daily_usage_date: chinaDateKey(now),
    daily_realtime_connections: 0,
    daily_replies: 0,
  };
}

function insertUser(db: Database.Database, row: UserRow): void {
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, password_salt, role,
      account_type, enabled, created_at, updated_at, last_login_at,
      usage_realtime_connections, usage_replies, daily_usage_date,
      daily_realtime_connections, daily_replies
    ) VALUES (
      @id, @username, @display_name, @password_hash, @password_salt, @role,
      @account_type, @enabled, @created_at, @updated_at, @last_login_at,
      @usage_realtime_connections, @usage_replies, @daily_usage_date,
      @daily_realtime_connections, @daily_replies
    )
  `).run(row);
}

function publicUser(row: UserRow): PublicUser {
  const today = chinaDateKey();
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    accountType: row.account_type,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}),
    usage: {
      realtimeConnections: row.usage_realtime_connections,
      replies: row.usage_replies,
    },
    dailyUsage: row.daily_usage_date === today
      ? {
          date: today,
          realtimeConnections: row.daily_realtime_connections,
          replies: row.daily_replies,
        }
      : { date: today, realtimeConnections: 0, replies: 0 },
  };
}

async function ensureAdmin(): Promise<void> {
  if (adminBootstrap) return adminBootstrap;
  adminBootstrap = (async () => {
    const db = database();
    const count = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    if (count.count > 0) return;
    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
      throw new AuthStoreError(
        "MISSING_ADMIN_PASSWORD",
        "首次启动前必须配置 ADMIN_PASSWORD。",
      );
    }
    const row = await newUser({
      username: process.env.ADMIN_USERNAME?.trim() || "admin",
      displayName: process.env.ADMIN_DISPLAY_NAME?.trim() || "管理员",
      password,
      role: "admin",
      accountType: "managed",
    });
    insertUser(db, row);
  })();
  try {
    await adminBootstrap;
  } catch (error) {
    adminBootstrap = null;
    throw error;
  }
}

function getRow(id: string): UserRow | undefined {
  return database().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
}

export async function authenticateUser(
  usernameInput: string,
  password: string,
): Promise<PublicUser | null> {
  return serialized(async () => {
    await ensureAdmin();
    const db = database();
    const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .get(normalizeUsername(usernameInput)) as UserRow | undefined;
    if (!row || row.enabled !== 1) return null;
    const actual = await passwordDigest(password, row.password_salt);
    const expected = Buffer.from(row.password_hash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const now = Date.now();
    db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, row.id);
    return publicUser({ ...row, last_login_at: now, updated_at: now });
  });
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  return serialized(async () => {
    await ensureAdmin();
    const row = getRow(id);
    return row ? publicUser(row) : null;
  });
}

export async function listUsers(): Promise<PublicUser[]> {
  return serialized(async () => {
    await ensureAdmin();
    const rows = database().prepare(
      "SELECT * FROM users ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at",
    ).all() as UserRow[];
    return rows.map(publicUser);
  });
}

export async function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  role?: UserRole;
}): Promise<PublicUser> {
  return serialized(async () => {
    await ensureAdmin();
    const db = database();
    const username = validateUsername(input.username);
    if (db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(username)) {
      throw new AuthStoreError("USER_EXISTS", "该用户名已存在。");
    }
    const row = await newUser({
      username,
      displayName: input.displayName,
      password: input.password,
      role: input.role ?? "user",
      accountType: "managed",
    });
    insertUser(db, row);
    return publicUser(row);
  });
}

export async function createGuestUser(): Promise<PublicUser> {
  return serialized(async () => {
    await ensureAdmin();
    const db = database();
    let username = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `guest_${randomBytes(5).toString("hex")}`;
      if (!db.prepare("SELECT 1 FROM users WHERE username = ?").get(candidate)) {
        username = candidate;
        break;
      }
    }
    if (!username) throw new AuthStoreError("USER_EXISTS", "暂时无法生成访客账号。");
    const suffix = username.slice(-4).toUpperCase();
    const row = await newUser({
      username,
      displayName: `树洞旅人 ${suffix}`,
      password: randomBytes(32).toString("base64url"),
      role: "user",
      accountType: "guest",
    });
    row.last_login_at = Date.now();
    row.updated_at = row.last_login_at;
    insertUser(db, row);
    return publicUser(row);
  });
}

function identitySecret(): string {
  const secret =
    process.env.OAUTH_IDENTITY_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("OAUTH_IDENTITY_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function identityHash(openId: string): string {
  return createHmac("sha256", identitySecret()).update(openId).digest("hex");
}

export async function upgradeGuestToWechat(
  guestUserId: string | null,
  openId: string,
): Promise<PublicUser> {
  return serialized(async () => {
    await ensureAdmin();
    const db = database();
    const fingerprint = identityHash(openId);
    const existing = db.prepare(`
      SELECT users.* FROM oauth_identities
      JOIN users ON users.id = oauth_identities.user_id
      WHERE oauth_identities.provider = 'wechat_official' AND subject_hash = ?
    `).get(fingerprint) as UserRow | undefined;
    const now = Date.now();
    if (existing) {
      if (guestUserId && guestUserId !== existing.id) {
        const merge = db.transaction(() => {
          db.prepare("UPDATE conversations SET user_id = ? WHERE user_id = ?")
            .run(existing.id, guestUserId);
          db.prepare("UPDATE voice_sessions SET user_id = ? WHERE user_id = ?")
            .run(existing.id, guestUserId);
          db.prepare("UPDATE users SET enabled = 0, updated_at = ? WHERE id = ? AND account_type = 'guest'")
            .run(now, guestUserId);
        });
        merge();
      }
      db.prepare("UPDATE oauth_identities SET last_login_at = ? WHERE provider = 'wechat_official' AND subject_hash = ?")
        .run(now, fingerprint);
      db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, existing.id);
      return publicUser({ ...existing, last_login_at: now, updated_at: now });
    }

    let row = guestUserId ? getRow(guestUserId) : undefined;
    if (!row || row.account_type !== "guest") {
      row = await newUser({
        username: `wechat_${fingerprint.slice(0, 10)}`,
        displayName: `树洞旅人 ${randomBytes(2).readUInt16BE().toString().padStart(5, "0")}`,
        password: randomBytes(32).toString("base64url"),
        role: "user",
        accountType: "wechat",
      });
      row.last_login_at = now;
      insertUser(db, row);
    } else {
      const username = `wechat_${fingerprint.slice(0, 10)}`;
      const displayName = `树洞旅人 ${randomBytes(2).readUInt16BE().toString().padStart(5, "0")}`;
      db.prepare(`
        UPDATE users SET username = ?, display_name = ?, account_type = 'wechat',
          last_login_at = ?, updated_at = ? WHERE id = ?
      `).run(username, displayName, now, now, row.id);
      row = {
        ...row,
        username,
        display_name: displayName,
        account_type: "wechat",
        last_login_at: now,
        updated_at: now,
      };
    }
    db.prepare(`
      INSERT INTO oauth_identities(provider, subject_hash, user_id, created_at, last_login_at)
      VALUES('wechat_official', ?, ?, ?, ?)
    `).run(fingerprint, row.id, now, now);
    return publicUser(row);
  });
}

function configuredGuestLimit(kind: UsageKind): number {
  const key =
    kind === "realtimeConnections"
      ? "GUEST_DAILY_CONNECTION_LIMIT"
      : "GUEST_DAILY_REPLY_LIMIT";
  const fallback = kind === "realtimeConnections" ? 10 : 50;
  const configured = Number(process.env[key]);
  return Number.isInteger(configured) && configured > 0 && configured <= 10_000
    ? configured
    : fallback;
}

export function usageAllowance(
  user: PublicUser,
  kind: UsageKind,
): { allowed: boolean; limit: number | null; used: number } {
  if (user.accountType !== "guest") return { allowed: true, limit: null, used: 0 };
  const limit = configuredGuestLimit(kind);
  const used = user.dailyUsage[kind];
  return { allowed: used < limit, limit, used };
}

export async function setUserEnabled(id: string, enabled: boolean): Promise<PublicUser> {
  return serialized(async () => {
    await ensureAdmin();
    const db = database();
    const result = db.prepare("UPDATE users SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, Date.now(), id);
    if (result.changes === 0) throw new AuthStoreError("USER_NOT_FOUND", "用户不存在。");
    return publicUser(getRow(id)!);
  });
}

export async function recordUsage(id: string, kind: UsageKind): Promise<void> {
  return serialized(async () => {
    await ensureAdmin();
    const db = database();
    const row = getRow(id);
    if (!row || row.enabled !== 1) return;
    const today = chinaDateKey();
    const dailyColumn =
      kind === "realtimeConnections" ? "daily_realtime_connections" : "daily_replies";
    const totalColumn =
      kind === "realtimeConnections" ? "usage_realtime_connections" : "usage_replies";
    if (row.daily_usage_date !== today) {
      db.prepare(`
        UPDATE users SET daily_usage_date = ?, daily_realtime_connections = 0,
          daily_replies = 0 WHERE id = ?
      `).run(today, id);
    }
    db.prepare(`
      UPDATE users SET ${totalColumn} = ${totalColumn} + 1,
        ${dailyColumn} = ${dailyColumn} + 1, updated_at = ? WHERE id = ?
    `).run(Date.now(), id);
  });
}

function quotaLimit(user: PublicUser): number | null {
  if (user.role === "admin") return null;
  const settings = getProductSettings();
  const key = user.accountType === "guest" ? "GUEST_TRIAL_SECONDS" : "WECHAT_DAILY_SECONDS";
  const fallback = user.accountType === "guest"
    ? settings.guestTrialSeconds
    : settings.wechatDailySeconds;
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 && value <= 86_400 ? value : fallback;
}

export async function voiceSecondsAllowance(
  userId: string,
  now = Date.now(),
): Promise<VoiceAllowance> {
  await ensureAdmin();
  const user = getRow(userId);
  if (!user) throw new AuthStoreError("USER_NOT_FOUND", "用户不存在。");
  const publicValue = publicUser(user);
  const limitSeconds = quotaLimit(publicValue);
  if (limitSeconds === null) {
    return { limitSeconds: null, usedSeconds: 0, remainingSeconds: null };
  }
  const start = user.account_type === "guest"
    ? 0
    : Date.parse(`${chinaDateKey(now)}T00:00:00+08:00`);
  const result = database().prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN status = 'active' THEN reserved_seconds ELSE used_seconds END
    ), 0) AS used
    FROM voice_sessions
    WHERE user_id = ? AND status != 'cancelled' AND started_at >= ?
  `).get(userId, start) as { used: number };
  const usedSeconds = Math.max(0, Math.round(result.used));
  return {
    limitSeconds,
    usedSeconds,
    remainingSeconds: Math.max(0, limitSeconds - usedSeconds),
  };
}

export async function reserveVoiceSession(
  userId: string,
  companionVoice: string,
): Promise<{ sessionId: string; quotaSeconds: number }> {
  return serialized(async () => {
    const allowance = await voiceSecondsAllowance(userId);
    const quotaSeconds = allowance.remainingSeconds ?? 30 * 60;
    if (quotaSeconds <= 0) throw new AuthStoreError("INVALID_PASSWORD", "语音额度已用完。");
    const sessionId = randomUUID();
    database().prepare(`
      INSERT INTO voice_sessions(
        id, user_id, reserved_seconds, used_seconds, status, companion_voice, started_at
      ) VALUES(?, ?, ?, 0, 'active', ?, ?)
    `).run(sessionId, userId, quotaSeconds, companionVoice, Date.now());
    return { sessionId, quotaSeconds };
  });
}

export async function finalizeVoiceSession(
  userId: string,
  sessionId: string,
  usedSeconds: number,
): Promise<void> {
  return serialized(async () => {
    const normalized = Math.max(0, Math.min(30 * 60, Math.ceil(usedSeconds)));
    database().prepare(`
      UPDATE voice_sessions SET used_seconds = MIN(reserved_seconds, ?),
        status = 'closed', finished_at = ?
      WHERE id = ? AND user_id = ? AND status = 'active'
    `).run(normalized, Date.now(), sessionId, userId);
  });
}

export async function cancelVoiceReservation(
  userId: string,
  sessionId: string,
): Promise<void> {
  return serialized(async () => {
    database().prepare(`
      UPDATE voice_sessions SET status = 'cancelled', finished_at = ?
      WHERE id = ? AND user_id = ? AND status = 'active'
    `).run(Date.now(), sessionId, userId);
  });
}

export async function recordVoiceUsage(userId: string, seconds: number): Promise<void> {
  const session = await reserveVoiceSession(userId, "breeze");
  await finalizeVoiceSession(userId, session.sessionId, seconds);
}

export function resetAuthStoreForTests(): void {
  operationQueue = Promise.resolve();
  adminBootstrap = null;
  resetDatabaseForTests();
}
