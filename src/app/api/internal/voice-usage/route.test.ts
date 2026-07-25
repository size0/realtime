import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  finalizeVoiceSession: vi.fn(),
}));

vi.mock("@/lib/auth-store", () => ({
  finalizeVoiceSession: mocks.finalizeVoiceSession,
}));

import {
  POST,
  verifyVoiceUsageSignature,
} from "@/app/api/internal/voice-usage/route";

const SECRET = "voice-worker-secret-with-at-least-32-characters";

function signedRequest(
  body: string,
  now: number,
  overrides: Record<string, string> = {},
): Request {
  const nonce = overrides["X-Voice-Nonce"] ?? `nonce-${crypto.randomUUID()}`;
  const signature = createHmac("sha256", SECRET)
    .update(`${now}.${nonce}.POST./api/internal/voice-usage.${body}`)
    .digest("hex");
  return new Request("http://localhost:3000/api/internal/voice-usage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Voice-Timestamp": String(now),
      "X-Voice-Nonce": nonce,
      "X-Voice-Signature": signature,
      ...overrides,
    },
    body,
  });
}

describe("POST /api/internal/voice-usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOICE_WORKER_SECRET = SECRET;
  });

  it("accepts an authentic worker report and closes the reservation", async () => {
    const now = Date.now();
    const body = JSON.stringify({
      userId: "user-1",
      sessionId: "voice-session-1",
      usedSeconds: 42,
    });
    const response = await POST(signedRequest(body, now));
    expect(response.status).toBe(200);
    expect(mocks.finalizeVoiceSession).toHaveBeenCalledWith(
      "user-1",
      "voice-session-1",
      42,
    );
  });

  it("rejects tampering, stale requests and invalid fields", async () => {
    const now = Date.now();
    const body = JSON.stringify({
      userId: "user-1",
      sessionId: "voice-session-1",
      usedSeconds: 42,
    });
    const tampered = signedRequest(body, now, {
      "X-Voice-Signature": "0".repeat(64),
    });
    expect((await POST(tampered)).status).toBe(401);
    expect(
      verifyVoiceUsageSignature(
        body,
        String(now - 360_000),
        "0".repeat(64),
        "nonce-stale",
        "POST",
        "/api/internal/voice-usage",
        now,
      ),
    )
      .toBe(false);

    const invalidBody = JSON.stringify({
      userId: "bad id",
      sessionId: "voice-session-1",
      usedSeconds: -1,
    });
    expect((await POST(signedRequest(invalidBody, now))).status).toBe(400);
  });

  it("rejects replayed worker usage reports", async () => {
    const now = Date.now();
    const nonce = `nonce-${crypto.randomUUID()}`;
    const body = JSON.stringify({
      userId: "user-1",
      sessionId: "voice-session-1",
      usedSeconds: 42,
    });

    expect((await POST(signedRequest(body, now, { "X-Voice-Nonce": nonce }))).status)
      .toBe(200);
    expect((await POST(signedRequest(body, now, { "X-Voice-Nonce": nonce }))).status)
      .toBe(401);
  });
});
