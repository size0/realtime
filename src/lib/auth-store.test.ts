import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authenticateUser,
  createGuestUser,
  createUser,
  getUserById,
  listUsers,
  recordUsage,
  resetAuthStoreForTests,
  setUserEnabled,
  usageAllowance,
} from "@/lib/auth-store";
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
    process.env.APP_DATA_FILE = path.join(directory, "users.json");
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_DISPLAY_NAME = "管理员";
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
    resetAuthStoreForTests();
  });

  afterEach(async () => {
    resetAuthStoreForTests();
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_DISPLAY_NAME;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    delete process.env.GUEST_DAILY_REPLY_LIMIT;
    await rm(directory, { recursive: true, force: true });
  });

  it("bootstraps the admin with a password hash and authenticates safely", async () => {
    const admin = await authenticateUser("ADMIN", "Admin-password-123");
    expect(admin).toMatchObject({ username: "admin", role: "admin", enabled: true });
    expect(await authenticateUser("admin", "wrong-password")).toBeNull();

    const stored = await readFile(process.env.APP_DATA_FILE!, "utf8");
    expect(stored).not.toContain("Admin-password-123");
    expect(stored).toContain("passwordHash");
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

    const stored = await readFile(process.env.APP_DATA_FILE!, "utf8");
    expect(stored).not.toContain('"password":"');
    delete process.env.GUEST_DAILY_REPLY_LIMIT;
  });
});
