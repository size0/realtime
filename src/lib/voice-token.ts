import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 60_000;
const MAX_TOKEN_BYTES = 2_048;
const SUBJECT_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface VoiceWorkerTokenPayload {
  v: typeof TOKEN_VERSION;
  sub: string;
  exp: number;
  nonce: string;
}

function voiceWorkerSecret(): string {
  const secret = process.env.VOICE_WORKER_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("VOICE_WORKER_SECRET or SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function signature(encodedPayload: string): string {
  return createHmac("sha256", voiceWorkerSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isPayload(value: unknown, now: number): value is VoiceWorkerTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.v === TOKEN_VERSION &&
    typeof payload.sub === "string" &&
    SUBJECT_PATTERN.test(payload.sub) &&
    typeof payload.exp === "number" &&
    Number.isSafeInteger(payload.exp) &&
    payload.exp > now &&
    payload.exp <= now + TOKEN_TTL_MS + 5_000 &&
    typeof payload.nonce === "string" &&
    NONCE_PATTERN.test(payload.nonce)
  );
}

export function createVoiceWorkerToken(
  subject: string,
  now = Date.now(),
  nonce = randomBytes(24).toString("base64url"),
): { token: string; expiresAt: number } {
  if (!SUBJECT_PATTERN.test(subject)) throw new Error("Invalid voice token subject.");
  if (!NONCE_PATTERN.test(nonce)) throw new Error("Invalid voice token nonce.");
  const payload: VoiceWorkerTokenPayload = {
    v: TOKEN_VERSION,
    sub: subject,
    exp: now + TOKEN_TTL_MS,
    nonce,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    token: `${encodedPayload}.${signature(encodedPayload)}`,
    expiresAt: payload.exp,
  };
}

export function verifyVoiceWorkerToken(
  token: string,
  now = Date.now(),
): VoiceWorkerTokenPayload | null {
  if (!token || Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;
  const encodedPayload = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);
  if (!safeEqual(signature(encodedPayload), providedSignature)) return null;

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    return isPayload(parsed, now) ? parsed : null;
  } catch {
    return null;
  }
}

