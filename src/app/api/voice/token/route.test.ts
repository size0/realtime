import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnectionRateLimitForTests } from "@/lib/rate-limit";

const authMocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  validCsrfToken: vi.fn(),
  recordUsage: vi.fn(),
  usageAllowance: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  getRequestSession: authMocks.getRequestSession,
  validCsrfToken: authMocks.validCsrfToken,
}));
vi.mock("@/lib/auth-store", () => ({
  recordUsage: authMocks.recordUsage,
  usageAllowance: authMocks.usageAllowance,
}));

import { POST } from "@/app/api/voice/token/route";

function makeRequest(origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/voice/token", {
    method: "POST",
    headers: {
      Origin: origin,
      Host: "localhost:3000",
      "X-CSRF-Token": "csrf-test",
      "X-Forwarded-For": "127.0.0.1",
    },
  });
}

describe("POST /api/voice/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConnectionRateLimitForTests();
    process.env.VOICE_WORKER_SECRET =
      "voice-worker-secret-with-at-least-32-characters";
    authMocks.getRequestSession.mockResolvedValue({
      user: { id: "user-test", accountType: "managed" },
      csrfToken: "csrf-test",
    });
    authMocks.validCsrfToken.mockReturnValue(true);
    authMocks.usageAllowance.mockReturnValue({
      allowed: true,
      limit: null,
      used: 0,
    });
    authMocks.recordUsage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.VOICE_WORKER_SECRET;
    delete process.env.SESSION_SECRET;
  });

  it("requires same-origin, login and CSRF", async () => {
    expect((await POST(makeRequest("https://attacker.example"))).status).toBe(403);
    authMocks.getRequestSession.mockResolvedValueOnce(null);
    expect((await POST(makeRequest())).status).toBe(401);
    authMocks.validCsrfToken.mockReturnValueOnce(false);
    expect((await POST(makeRequest())).status).toBe(403);
  });

  it("returns only an expiring worker token and records the connection", async () => {
    const response = await POST(makeRequest());
    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.websocketPath).toBe("/voice-ws");
    expect(payload.token).toEqual(expect.any(String));
    expect(JSON.stringify(payload)).not.toContain(process.env.VOICE_WORKER_SECRET);
    expect(authMocks.recordUsage).toHaveBeenCalledWith(
      "user-test",
      "realtimeConnections",
    );
  });

  it("does not issue a token when daily allowance is exhausted", async () => {
    authMocks.usageAllowance.mockReturnValueOnce({
      allowed: false,
      limit: 10,
      used: 10,
    });
    const response = await POST(makeRequest());
    expect(response.status).toBe(429);
    expect(authMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("returns a safe configuration error without exposing secrets", async () => {
    delete process.env.VOICE_WORKER_SECRET;
    const response = await POST(makeRequest());
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).not.toContain("SESSION_SECRET");
    expect(body).not.toContain("VOICE_WORKER_SECRET");
  });
});
