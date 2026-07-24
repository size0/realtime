import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/conversations/route";
import { createGuestUser, resetAuthStoreForTests } from "@/lib/auth-store";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { resetDatabaseForTests } from "@/lib/database";

describe("/api/conversations", () => {
  let directory = "";
  let cookie = "";
  let csrf = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "conversation-api-"));
    process.env.APP_DATABASE_FILE = path.join(directory, "app.sqlite");
    process.env.APP_DATA_FILE = path.join(directory, "missing.json");
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
    process.env.MESSAGE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    resetDatabaseForTests();
    resetAuthStoreForTests();
    const session = createSession(await createGuestUser());
    cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.token)}`;
    csrf = session.csrfToken;
  });

  afterEach(async () => {
    resetAuthStoreForTests();
    resetDatabaseForTests();
    delete process.env.APP_DATABASE_FILE;
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    delete process.env.MESSAGE_ENCRYPTION_KEY;
    await rm(directory, { recursive: true, force: true });
  });

  it("creates and lists only the signed-in user's conversations", async () => {
    const created = await POST(new Request("http://localhost:3000/api/conversations", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        Host: "localhost:3000",
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({ companionVoice: "breeze" }),
    }));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      conversation: expect.objectContaining({ companionVoice: "breeze" }),
    });

    const listed = await GET(new Request("http://localhost:3000/api/conversations", {
      headers: { Cookie: cookie },
    }));
    expect(listed.status).toBe(200);
    expect((await listed.json()).conversations).toHaveLength(1);
  });

  it("rejects missing auth, bad CSRF and invalid voices", async () => {
    expect((await GET(new Request("http://localhost:3000/api/conversations"))).status)
      .toBe(401);
    const invalid = new Request("http://localhost:3000/api/conversations", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        Host: "localhost:3000",
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": "bad",
      },
      body: JSON.stringify({ companionVoice: "unknown" }),
    });
    expect((await POST(invalid)).status).toBe(403);
  });
});
