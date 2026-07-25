import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

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

export function verifyVoiceWorkerSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  now = Date.now(),
): boolean {
  const timestamp = Number(timestampHeader);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS ||
    !signatureHeader ||
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
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return safeEqual(expected, signatureHeader);
}
