import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authenticateUser,
  createGuestUser,
  createUser,
  getUserById,
  listUsers,
  recordVoiceUsage,
  recordUsage,
  resetAuthStoreForTests,
  setUserEnabled,
  upgradeGuestToWechat,
  usageAllowance,
  voiceSecondsAllowance,
} from "@/lib/auth-store";
import { resetDatabaseForTests } from "@/lib/database";
import {
  createSession,
  getRequestSession,
  SESSION_COOKIE_NAME,
  sessionCookie,
  validCsrfToken,
} from "@/lib/auth-session";

describe("authentication store and signed sessions", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "voice-auth-"));
    process.env.APP_DATABASE_FILE = path.join(directory, "app.sqlite");
    process.env.APP_DATA_FILE = path.join(directory, "users.json");
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_DISPLAY_NAME = "管理员";
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
    process.env.OAUTH_IDENTITY_SECRET = "test-oauth-secret-that-is-longer-than-32-characters";
    resetDatabaseForTests();
    resetAuthStoreForTests();
  });

  afterEach(async () => {
    resetAuthStoreForTests();
    resetDatabaseForTests();
    delete process.env.APP_DATABASE_FILE;
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_DISPLAY_NAME;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    delete process.env.OAUTH_IDENTITY_SECRET;
    delete process.env.GUEST_DAILY_REPLY_LIMIT;
    delete process.env.GUEST_TRIAL_SECONDS;
    delete process.env.WECHAT_DAILY_SECONDS;
    await rm(directory, { recursive: true, force: true });
  });

  it("bootstraps the admin with a password hash and authenticates safely", async () => {
    const admin = await authenticateUser("ADMIN", "Admin-password-123");
    expect(admin).toMatchObject({ username: "admin", role: "admin", enabled: true });
    expect(await authenticateUser("admin", "wrong-password")).toBeNull();

    const stored = await readFile(process.env.APP_DATABASE_FILE!);
    expect(stored.toString("utf8")).not.toContain("Admin-password-123");
  });

  it("invalidates an existing signed session when a user is disabled", async () => {
    const user = await createUser({
      username: "guest.one",
      displayName: "访客一号",
      password: "Guest-password-123",
    });
    const created = createSession(user);
    const request = new Request("http://localhost:3000/api/auth/session", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(created.token)}` },
    });

    const activeSession = await getRequestSession(request);
    expect(activeSession).toMatchObject({ user: { id: user.id } });
    expect(validCsrfToken(activeSession!, created.csrfToken)).toBe(true);
    expect(sessionCookie(created.token)).toContain("HttpOnly");
    expect(sessionCookie(created.token)).toContain("SameSite=Strict");

    await setUserEnabled(user.id, false);
    expect(await getRequestSession(request)).toBeNull();
    expect((await listUsers()).find((entry) => entry.id === user.id)?.enabled).toBe(false);
  });

  it("creates passwordless guests and enforces their configurable daily allowance", async () => {
    process.env.GUEST_DAILY_REPLY_LIMIT = "1";
    const guest = await createGuestUser();
    expect(guest).toMatchObject({ role: "user", accountType: "guest", enabled: true });
    expect(guest.username).toMatch(/^guest_[a-f0-9]{10}$/);
    expect(usageAllowance(guest, "replies")).toMatchObject({ allowed: true, limit: 1, used: 0 });

    await recordUsage(guest.id, "replies");
    const updated = await getUserById(guest.id);
    expect(updated?.dailyUsage.replies).toBe(1);
    expect(usageAllowance(updated!, "replies")).toMatchObject({ allowed: false, limit: 1, used: 1 });

    const stored = await readFile(process.env.APP_DATABASE_FILE!);
    expect(stored.toString("utf8")).not.toContain('"password":"');
    delete process.env.GUEST_DAILY_REPLY_LIMIT;
  });

  it("imports the legacy JSON store once and preserves ids and hashes", async () => {
    resetDatabaseForTests();
    const legacyPath = process.env.APP_DATA_FILE!;
    const now = Date.now();
    await writeFile(
      legacyPath,
      JSON.stringify({
        version: 1,
        users: [{
          id: "legacy-user",
          username: "legacy",
          displayName: "旧用户",
          passwordHash: "00",
          passwordSalt: "11",
          role: "user",
          accountType: "managed",
          enabled: true,
          createdAt: now,
          updatedAt: now,
          usage: { realtimeConnections: 4, replies: 7 },
          dailyUsage: {
            date: new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
            realtimeConnections: 2,
            replies: 3,
          },
        }],
      }),
      "utf8",
    );

    const users = await listUsers();
    expect(users.find((user) => user.id === "legacy-user")).toMatchObject({
      username: "legacy",
      usage: { realtimeConnections: 4, replies: 7 },
    });
  });

  it("upgrades a guest to a pseudonymous WeChat account and enforces seconds", async () => {
    process.env.GUEST_TRIAL_SECONDS = "180";
    process.env.WECHAT_DAILY_SECONDS = "600";
    const guest = await createGuestUser();
    await recordVoiceUsage(guest.id, 120);
    expect(await voiceSecondsAllowance(guest.id)).toMatchObject({
      limitSeconds: 180,
      usedSeconds: 120,
      remainingSeconds: 60,
    });

    const upgraded = await upgradeGuestToWechat(
      guest.id,
      "openid-never-store-plain",
    );
    expect(upgraded).toMatchObject({
      id: guest.id,
      accountType: "wechat",
      role: "user",
    });
    expect(upgraded.username).not.toContain("openid-never-store-plain");
    expect(await voiceSecondsAllowance(upgraded.id)).toMatchObject({
      limitSeconds: 600,
      usedSeconds: 120,
      remainingSeconds: 480,
    });

    const stored = await readFile(process.env.APP_DATABASE_FILE!);
    expect(stored.toString("utf8")).not.toContain("openid-never-store-plain");
  });
});
