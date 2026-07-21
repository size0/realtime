import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/auth/guest/route";
import { listUsers, resetAuthStoreForTests } from "@/lib/auth-store";
import { resetGuestCreationRateLimitForTests } from "@/lib/rate-limit";

function request(origin = "http://localhost:3000", ip = "127.0.0.1") {
  return new Request("http://localhost:3000/api/auth/guest", {
    method: "POST",
    headers: {
      Origin: origin,
      Host: "localhost:3000",
      "X-Forwarded-For": ip,
    },
  });
}

describe("POST /api/auth/guest", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "voice-guest-"));
    process.env.APP_DATA_FILE = path.join(directory, "users.json");
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
    resetAuthStoreForTests();
    resetGuestCreationRateLimitForTests();
  });

  afterEach(async () => {
    resetAuthStoreForTests();
    resetGuestCreationRateLimitForTests();
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    await rm(directory, { recursive: true, force: true });
  });

  it("creates a guest account and a secure server session without returning credentials", async () => {
    const response = await POST(request());
    const body = await response.text();
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(body).toContain('"accountType":"guest"');
    expect(body).not.toContain("password");

    const users = await listUsers();
    expect(users.filter((user) => user.accountType === "guest")).toHaveLength(1);
  });

  it("rejects cross-origin requests and rate limits account creation by IP", async () => {
    expect((await POST(request("https://attacker.example"))).status).toBe(403);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await POST(request("http://localhost:3000", "127.0.0.8"))).status).toBe(201);
    }
    const limited = await POST(request("http://localhost:3000", "127.0.0.8"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
