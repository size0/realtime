import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, PATCH, POST } from "@/app/api/admin/users/route";
import { authenticateUser, createUser, resetAuthStoreForTests } from "@/lib/auth-store";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { resetAdminMutationRateLimitForTests } from "@/lib/rate-limit";

function request(token: string, csrfToken: string, method: "GET" | "POST" | "PATCH", body?: unknown) {
  return new Request("http://localhost:3000/api/admin/users", {
    method,
    headers: {
      Origin: "http://localhost:3000",
      Host: "localhost:3000",
      Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      "X-Forwarded-For": "127.0.0.1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("admin user API", () => {
  let directory = "";
  let token = "";
  let csrfToken = "";
  let adminId = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "voice-admin-"));
    process.env.APP_DATA_FILE = path.join(directory, "users.json");
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
    resetAuthStoreForTests();
    resetAdminMutationRateLimitForTests();
    const admin = await authenticateUser("admin", "Admin-password-123");
    if (!admin) throw new Error("admin bootstrap failed");
    adminId = admin.id;
    const session = createSession(admin);
    token = session.token;
    csrfToken = session.csrfToken;
  });

  afterEach(async () => {
    resetAuthStoreForTests();
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    await rm(directory, { recursive: true, force: true });
  });

  it("lets an admin create and list users", async () => {
    const created = await POST(
      request(token, csrfToken, "POST", {
        username: "member",
        displayName: "成员",
        password: "Member-password-123",
        role: "user",
      }),
    );
    expect(created.status).toBe(201);

    const listed = await GET(request(token, csrfToken, "GET"));
    const payload = (await listed.json()) as { users: Array<{ username: string }> };
    expect(payload.users.map((user) => user.username)).toContain("member");
  });

  it("rejects bad CSRF, non-admin users and self-disable", async () => {
    const badCsrf = await POST(
      request(token, "wrong", "POST", {
        username: "member",
        displayName: "成员",
        password: "Member-password-123",
      }),
    );
    expect(badCsrf.status).toBe(403);

    const user = await createUser({
      username: "regular",
      displayName: "普通用户",
      password: "Regular-password-123",
    });
    const userSession = createSession(user);
    expect((await GET(request(userSession.token, userSession.csrfToken, "GET"))).status).toBe(403);

    const selfDisable = await PATCH(
      request(token, csrfToken, "PATCH", { id: adminId, enabled: false }),
    );
    expect(selfDisable.status).toBe(400);
  });
});
