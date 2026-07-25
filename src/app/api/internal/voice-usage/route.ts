import { finalizeVoiceSession } from "@/lib/auth-store";
import { jsonError } from "@/lib/request-security";
import { verifyVoiceWorkerSignature } from "@/lib/voice-worker-signature";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export function verifyVoiceUsageSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  now = Date.now(),
): boolean {
  return verifyVoiceWorkerSignature(
    rawBody,
    timestampHeader,
    signatureHeader,
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
