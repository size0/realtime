import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnectionRateLimitForTests } from "@/lib/rate-limit";

const authMocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  validCsrfToken: vi.fn(),
  recordUsage: vi.fn(),
  reserveVoiceSession: vi.fn(),
  cancelVoiceReservation: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  getRequestSession: authMocks.getRequestSession,
  validCsrfToken: authMocks.validCsrfToken,
}));
vi.mock("@/lib/auth-store", () => ({
  recordUsage: authMocks.recordUsage,
  reserveVoiceSession: authMocks.reserveVoiceSession,
  cancelVoiceReservation: authMocks.cancelVoiceReservation,
}));

import { POST } from "@/app/api/voice/token/route";

function makeRequest(
  origin = "http://localhost:3000",
  body: unknown = { companionVoice: "breeze" },
) {
  return new Request("http://localhost:3000/api/voice/token", {
    method: "POST",
    headers: {
      Origin: origin,
      Host: "localhost:3000",
      "Content-Type": "application/json",
      "X-CSRF-Token": "csrf-test",
      "X-Forwarded-For": "127.0.0.1",
    },
    body: JSON.stringify(body),
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
    authMocks.reserveVoiceSession.mockResolvedValue({
      sessionId: "voice-session-123",
      quotaSeconds: 180,
    });
    authMocks.recordUsage.mockResolvedValue(undefined);
    authMocks.cancelVoiceReservation.mockResolvedValue(undefined);
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
    expect(payload.remainingSeconds).toBe(180);
    expect(JSON.stringify(payload)).not.toContain(process.env.VOICE_WORKER_SECRET);
    expect(authMocks.recordUsage).toHaveBeenCalledWith(
      "user-test",
      "realtimeConnections",
    );
  });

  it("does not issue a token when seconds are exhausted or voice is invalid", async () => {
    authMocks.reserveVoiceSession.mockRejectedValueOnce(new Error("语音额度已用完。"));
    const response = await POST(makeRequest());
    expect(response.status).toBe(429);
    expect(authMocks.recordUsage).not.toHaveBeenCalled();
    expect((await POST(makeRequest("http://localhost:3000", {
      companionVoice: "unknown",
    }))).status).toBe(400);
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
