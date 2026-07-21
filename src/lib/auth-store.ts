import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const STORE_VERSION = 1;
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

export type UserRole = "admin" | "user";
export type UsageKind = "realtimeConnections" | "replies";

interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  role: UserRole;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  usage: Record<UsageKind, number>;
}

interface UserDatabase {
  version: typeof STORE_VERSION;
  users: StoredUser[];
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  usage: Record<UsageKind, number>;
}

export class AuthStoreError extends Error {
  constructor(
    public readonly code:
      | "INVALID_USERNAME"
      | "INVALID_PASSWORD"
      | "INVALID_DISPLAY_NAME"
      | "USER_EXISTS"
      | "USER_NOT_FOUND"
      | "MISSING_ADMIN_PASSWORD"
      | "CORRUPT_STORE",
    message: string,
  ) {
    super(message);
    this.name = "AuthStoreError";
  }
}

let operationQueue: Promise<void> = Promise.resolve();

function storePath(): string {
  const configured = process.env.APP_DATA_FILE?.trim();
  return configured || ".data/users.json";
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

function isStoredUser(value: unknown): value is StoredUser {
  if (typeof value !== "object" || value === null) return false;
  const user = value as Record<string, unknown>;
  const usage = user.usage;
  return (
    typeof user.id === "string" &&
    typeof user.username === "string" &&
    typeof user.displayName === "string" &&
    typeof user.passwordHash === "string" &&
    typeof user.passwordSalt === "string" &&
    (user.role === "admin" || user.role === "user") &&
    typeof user.enabled === "boolean" &&
    typeof user.createdAt === "number" &&
    typeof user.updatedAt === "number" &&
    typeof usage === "object" &&
    usage !== null &&
    typeof (usage as Record<string, unknown>).realtimeConnections === "number" &&
    typeof (usage as Record<string, unknown>).replies === "number"
  );
}

function publicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    enabled: user.enabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    usage: { ...user.usage },
  };
}

async function passwordDigest(password: string, salt: string): Promise<Buffer> {
  return (await scrypt(password, salt, 64)) as Buffer;
}

async function createStoredUser(input: {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
}): Promise<StoredUser> {
  const username = validateUsername(input.username);
  const displayName = validateDisplayName(input.displayName);
  validatePassword(input.password);
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = (await passwordDigest(input.password, passwordSalt)).toString("hex");
  const now = Date.now();
  return {
    id: randomUUID(),
    username,
    displayName,
    passwordHash,
    passwordSalt,
    role: input.role,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    usage: { realtimeConnections: 0, replies: 0 },
  };
}

async function bootstrapDatabase(): Promise<UserDatabase> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new AuthStoreError(
      "MISSING_ADMIN_PASSWORD",
      "首次启动前必须配置 ADMIN_PASSWORD。",
    );
  }

  const username = process.env.ADMIN_USERNAME?.trim() || "admin";
  const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || "管理员";
  const admin = await createStoredUser({ username, displayName, password, role: "admin" });
  return { version: STORE_VERSION, users: [admin] };
}

async function readDatabaseUnlocked(): Promise<{ database: UserDatabase; isNew: boolean }> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ storePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>).version !== STORE_VERSION ||
      !Array.isArray((parsed as Record<string, unknown>).users)
    ) {
      throw new AuthStoreError("CORRUPT_STORE", "用户数据库格式无效。");
    }
    const users = (parsed as { users: unknown[] }).users;
    if (!users.every(isStoredUser)) {
      throw new AuthStoreError("CORRUPT_STORE", "用户数据库内容无效。");
    }
    return { database: { version: STORE_VERSION, users }, isNew: false };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { database: await bootstrapDatabase(), isNew: true };
    }
    throw error;
  }
}

async function writeDatabaseUnlocked(database: UserDatabase): Promise<void> {
  const target = storePath();
  const separatorIndex = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"));
  const directory = separatorIndex >= 0 ? target.slice(0, separatorIndex) : ".";
  await mkdir(/*turbopackIgnore: true*/ directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ temporary, JSON.stringify(database, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(/*turbopackIgnore: true*/ temporary, target);
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function loadDatabase(): Promise<UserDatabase> {
  const loaded = await readDatabaseUnlocked();
  if (loaded.isNew) await writeDatabaseUnlocked(loaded.database);
  return loaded.database;
}

export async function authenticateUser(
  usernameInput: string,
  password: string,
): Promise<PublicUser | null> {
  return serialized(async () => {
    const username = normalizeUsername(usernameInput);
    const database = await loadDatabase();
    const user = database.users.find((candidate) => candidate.username === username);
    if (!user || !user.enabled) return null;

    const actual = await passwordDigest(password, user.passwordSalt);
    const expected = Buffer.from(user.passwordHash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    user.lastLoginAt = Date.now();
    user.updatedAt = user.lastLoginAt;
    await writeDatabaseUnlocked(database);
    return publicUser(user);
  });
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  return serialized(async () => {
    const database = await loadDatabase();
    const user = database.users.find((candidate) => candidate.id === id);
    return user ? publicUser(user) : null;
  });
}

export async function listUsers(): Promise<PublicUser[]> {
  return serialized(async () => {
    const database = await loadDatabase();
    return database.users
      .map(publicUser)
      .sort((left, right) => Number(right.role === "admin") - Number(left.role === "admin") || left.createdAt - right.createdAt);
  });
}

export async function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  role?: UserRole;
}): Promise<PublicUser> {
  return serialized(async () => {
    const database = await loadDatabase();
    const username = validateUsername(input.username);
    if (database.users.some((user) => user.username === username)) {
      throw new AuthStoreError("USER_EXISTS", "该用户名已存在。");
    }

    const user = await createStoredUser({
      username,
      displayName: input.displayName,
      password: input.password,
      role: input.role ?? "user",
    });
    database.users.push(user);
    await writeDatabaseUnlocked(database);
    return publicUser(user);
  });
}

export async function setUserEnabled(id: string, enabled: boolean): Promise<PublicUser> {
  return serialized(async () => {
    const database = await loadDatabase();
    const user = database.users.find((candidate) => candidate.id === id);
    if (!user) throw new AuthStoreError("USER_NOT_FOUND", "用户不存在。");
    user.enabled = enabled;
    user.updatedAt = Date.now();
    await writeDatabaseUnlocked(database);
    return publicUser(user);
  });
}

export async function recordUsage(id: string, kind: UsageKind): Promise<void> {
  return serialized(async () => {
    const database = await loadDatabase();
    const user = database.users.find((candidate) => candidate.id === id);
    if (!user || !user.enabled) return;
    user.usage[kind] += 1;
    user.updatedAt = Date.now();
    await writeDatabaseUnlocked(database);
  });
}

export function resetAuthStoreForTests(): void {
  operationQueue = Promise.resolve();
}
