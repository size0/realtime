import { createHmac, timingSafeEqual } from "node:crypto";
import { database } from "@/lib/database";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function workerSecret(): string {
  const secret =
    process.env.VOICE_WORKER_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("Voice worker secret is not configured.");
  }
  return secret;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "ascii");
  const rightBuffer = Buffer.from(right, "ascii");
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function consumeNonce(nonce: string, expiresAt: number, now: number): boolean {
  if (!NONCE_PATTERN.test(nonce)) return false;
  const db = database();
  return db.transaction(() => {
    db.prepare("DELETE FROM voice_worker_nonces WHERE expires_at <= ?").run(now);
    const result = db.prepare(
      "INSERT OR IGNORE INTO voice_worker_nonces(nonce, expires_at) VALUES(?, ?)",
    ).run(nonce, expiresAt);
    return result.changes === 1;
  })();
}

export function verifyVoiceWorkerSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  nonceHeader: string | null,
  method: string,
  path: string,
  now = Date.now(),
): boolean {
  const timestamp = Number(timestampHeader);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS ||
    !signatureHeader ||
    !nonceHeader ||
    !SIGNATURE_PATTERN.test(signatureHeader)
  ) {
    return false;
  }
  let secret: string;
  try {
    secret = workerSecret();
  } catch {
    return false;
  }
  const normalizedMethod = method.toUpperCase();
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${nonceHeader}.${normalizedMethod}.${path}.${rawBody}`)
    .digest("hex");
  if (!safeEqual(expected, signatureHeader)) return false;
  return consumeNonce(nonceHeader, timestamp + MAX_CLOCK_SKEW_MS, now);
}
