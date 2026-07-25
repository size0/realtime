import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATCH } from "@/app/api/admin/settings/route";
import { authenticateUser, resetAuthStoreForTests } from "@/lib/auth-store";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { resetAdminMutationRateLimitForTests } from "@/lib/rate-limit";
import { resetDatabaseForTests } from "@/lib/database";
import { getProviderConfig } from "@/lib/provider-config";

function request(token: string, csrfToken: string, body: unknown) {
  return new Request("http://localhost:3000/api/admin/settings", {
    method: "PATCH",
    headers: {
      Origin: "http://localhost:3000",
      Host: "localhost:3000",
      Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      "X-Forwarded-For": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

describe("admin settings API", () => {
  let directory = "";
  let token = "";
  let csrfToken = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "voice-settings-"));
    process.env.APP_DATABASE_FILE = path.join(directory, "app.sqlite");
    process.env.APP_DATA_FILE = path.join(directory, "users.json");
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
    process.env.MESSAGE_ENCRYPTION_KEY = "11".repeat(32);
    resetAuthStoreForTests();
    resetAdminMutationRateLimitForTests();
    const admin = await authenticateUser("admin", "Admin-password-123");
    if (!admin) throw new Error("admin bootstrap failed");
    const session = createSession(admin);
    token = session.token;
    csrfToken = session.csrfToken;
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

  it("does not save provider secrets when product settings are invalid", async () => {
    const response = await PATCH(
      request(token, csrfToken, {
        vadSilenceMs: 9999,
        providerConfig: {
          dashscope: {
            apiKey: {
              action: "replace",
              value: "new-dashscope-secret",
            },
          },
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(getProviderConfig().dashscope.apiKey).toBe("");
  });
});
