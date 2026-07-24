import { createHmac, timingSafeEqual } from "node:crypto";
import { finalizeVoiceSession } from "@/lib/auth-store";
import { jsonError } from "@/lib/request-security";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
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

export function verifyVoiceUsageSignature(
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

export async function POST(request: Request): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError("INVALID_USAGE_REPORT", "用量上报格式无效。", 400);
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return jsonError("INVALID_USAGE_REPORT", "用量上报过大。", 413);
  }
  if (!verifyVoiceUsageSignature(
    rawBody,
    request.headers.get("x-voice-timestamp"),
    request.headers.get("x-voice-signature"),
  )) {
    return jsonError("INVALID_USAGE_SIGNATURE", "用量上报签名无效。", 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError("INVALID_USAGE_REPORT", "用量上报格式无效。", 400);
  }
  const input = body as Record<string, unknown>;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof input.userId !== "string" ||
    !IDENTIFIER_PATTERN.test(input.userId) ||
    typeof input.sessionId !== "string" ||
    !IDENTIFIER_PATTERN.test(input.sessionId) ||
    typeof input.usedSeconds !== "number" ||
    !Number.isInteger(input.usedSeconds) ||
    input.usedSeconds < 0 ||
    input.usedSeconds > 30 * 60
  ) {
    return jsonError("INVALID_USAGE_REPORT", "用量上报字段无效。", 400);
  }

  await finalizeVoiceSession(input.userId, input.sessionId, input.usedSeconds);
  return Response.json(
    { accepted: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
