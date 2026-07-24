import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVoiceWorkerToken, verifyVoiceWorkerToken } from "@/lib/voice-token";

describe("voice worker tokens", () => {
  beforeEach(() => {
    process.env.VOICE_WORKER_SECRET = "voice-worker-secret-with-at-least-32-characters";
  });

  afterEach(() => {
    delete process.env.VOICE_WORKER_SECRET;
    delete process.env.SESSION_SECRET;
  });

  it("creates a short-lived signed token that Python can verify with the same schema", () => {
    const issued = createVoiceWorkerToken(
      "user-123",
      "voice-session-123",
      "breeze",
      180,
      1_700_000_000_000,
      "abcdefghijklmnopqrstuvwx",
    );
    expect(verifyVoiceWorkerToken(issued.token, 1_700_000_030_000)).toEqual({
      v: 2,
      sub: "user-123",
      sid: "voice-session-123",
      voice: "breeze",
      quota: 180,
      exp: 1_700_000_060_000,
      nonce: "abcdefghijklmnopqrstuvwx",
    });
  });

  it("rejects tampering, expiry and malformed subjects", () => {
    const issued = createVoiceWorkerToken(
      "user-123",
      "voice-session-123",
      "glow",
      600,
      1_700_000_000_000,
      "abcdefghijklmnopqrstuvwx",
    );
    expect(verifyVoiceWorkerToken(`${issued.token}x`, 1_700_000_001_000)).toBeNull();
    expect(verifyVoiceWorkerToken(issued.token, issued.expiresAt)).toBeNull();
    expect(() =>
      createVoiceWorkerToken("user id with spaces", "session", "breeze", 180)
    ).toThrow();
    expect(() =>
      createVoiceWorkerToken("user-123", "session", "unknown", 180)
    ).toThrow();
  });

  it("falls back to the session secret without exposing it in the token", () => {
    delete process.env.VOICE_WORKER_SECRET;
    process.env.SESSION_SECRET = "session-secret-with-at-least-32-characters";
    const issued = createVoiceWorkerToken(
      "user-123",
      "voice-session-123",
      "nightwatch",
      600,
    );
    expect(issued.token).not.toContain(process.env.SESSION_SECRET);
    expect(verifyVoiceWorkerToken(issued.token)).toMatchObject({
      sub: "user-123",
      sid: "voice-session-123",
      voice: "nightwatch",
      quota: 600,
    });
  });
});
