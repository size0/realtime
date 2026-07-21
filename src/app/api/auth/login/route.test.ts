import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests } from "@/lib/auth-store";
import { resetLoginRateLimitForTests } from "@/lib/rate-limit";
import { POST } from "@/app/api/auth/login/route";

function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      Origin: origin,
      Host: "localhost:3000",
      "Content-Type": "application/json",
      "X-Forwarded-For": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "voice-login-"));
    process.env.APP_DATA_FILE = path.join(directory, "users.json");
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
    resetAuthStoreForTests();
    resetLoginRateLimitForTests();
  });

  afterEach(async () => {
    resetAuthStoreForTests();
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    await rm(directory, { recursive: true, force: true });
  });

  it("sets a server-side session cookie without exposing a password", async () => {
    const response = await POST(request({ username: "admin", password: "Admin-password-123" }));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(body).not.toContain("Admin-password-123");
    expect(body).toContain("csrfToken");
  });

  it("returns a generic error for invalid credentials and rejects cross-origin", async () => {
    const invalid = await POST(request({ username: "admin", password: "wrong-password" }));
    expect(invalid.status).toBe(401);
    expect(await invalid.text()).toContain("用户名或密码错误");

    const crossOrigin = await POST(
      request({ username: "admin", password: "Admin-password-123" }, "https://attacker.example"),
    );
    expect(crossOrigin.status).toBe(403);
  });
});
