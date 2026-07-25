import { finalizeVoiceSession } from "@/lib/auth-store";
import { database } from "@/lib/database";
import { getProviderConfig } from "@/lib/provider-config";
import { jsonError } from "@/lib/request-security";
import { verifyVoiceWorkerSignature } from "@/lib/voice-worker-signature";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function optionalMeter(value: unknown, maximum: number): number {
  if (value === undefined) return 0;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum
    ? value
    : -1;
}

function recordProviderUsage(input: {
  userId: string;
  sessionId: string;
  asrSeconds: number;
  ttsCharacters: number;
}): void {
  if (input.asrSeconds <= 0 && input.ttsCharacters <= 0) return;
  const pricing = getProviderConfig().pricing;
  const now = Date.now();
  const db = database();
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(input.userId)) {
    return;
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO usage_events(
      id, user_id, conversation_id, provider, model, kind, quantity,
      estimated_cost_cny, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  if (input.asrSeconds > 0) {
    insert.run(
      `voice:${input.sessionId}:asr`,
      input.userId,
      input.sessionId,
      "voice-worker",
      "sensevoice-local",
      "asr_seconds",
      input.asrSeconds,
      (input.asrSeconds / 3600) * pricing.asrPerHour,
      now,
    );
  }
  if (input.ttsCharacters > 0) {
    insert.run(
      `voice:${input.sessionId}:tts`,
      input.userId,
      input.sessionId,
      "dashscope",
      "qwen3-realtime-tts",
      "tts_characters",
      input.ttsCharacters,
      (input.ttsCharacters / 10_000) * pricing.ttsPer10kChars,
      now,
    );
  }
}

export function verifyVoiceUsageSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  nonceHeader: string | null,
  method = "POST",
  path = "/api/internal/voice-usage",
  now = Date.now(),
): boolean {
  return verifyVoiceWorkerSignature(
    rawBody,
    timestampHeader,
    signatureHeader,
    nonceHeader,
    method,
    path,
    now,
  );
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
  const path = new URL(request.url).pathname;
  if (!verifyVoiceUsageSignature(
    rawBody,
    request.headers.get("x-voice-timestamp"),
    request.headers.get("x-voice-signature"),
    request.headers.get("x-voice-nonce"),
    request.method,
    path,
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
  const asrSeconds = optionalMeter(input.asrSeconds, 30 * 60);
  const ttsCharacters = optionalMeter(input.ttsCharacters, 100_000);
  if (asrSeconds < 0 || ttsCharacters < 0) {
    return jsonError("INVALID_USAGE_REPORT", "用量上报字段无效。", 400);
  }

  await finalizeVoiceSession(input.userId, input.sessionId, input.usedSeconds);
  recordProviderUsage({
    userId: input.userId,
    sessionId: input.sessionId,
    asrSeconds,
    ttsCharacters,
  });
  return Response.json(
    { accepted: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
