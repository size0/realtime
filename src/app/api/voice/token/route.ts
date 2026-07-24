import { getRequestSession, validCsrfToken } from "@/lib/auth-session";
import {
  cancelVoiceReservation,
  recordUsage,
  reserveVoiceSession,
} from "@/lib/auth-store";
import { checkConnectionRateLimit } from "@/lib/rate-limit";
import {
  hasSameOrigin,
  jsonError,
  requestClientIdentifier,
} from "@/lib/request-security";
import { createVoiceWorkerToken } from "@/lib/voice-token";
import { isCompanionVoice } from "@/types/product";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 2 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) {
    return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  }
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "页面会话已过期，请刷新后重试。", 403);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return jsonError("INVALID_VOICE", "陪伴角色请求过大。", 413);
    }
    body = JSON.parse(raw);
  } catch {
    return jsonError("INVALID_VOICE", "请选择有效的陪伴角色。", 400);
  }
  const companionVoice =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).companionVoice
      : null;
  if (!isCompanionVoice(companionVoice)) {
    return jsonError("INVALID_VOICE", "请选择有效的陪伴角色。", 400);
  }

  const rateLimit = checkConnectionRateLimit(
    `${requestClientIdentifier(request)}:${session.user.id}:split`,
  );
  if (!rateLimit.allowed) {
    return jsonError("RATE_LIMITED", "语音连接请求过于频繁。", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  let reservation: { sessionId: string; quotaSeconds: number };
  try {
    reservation = await reserveVoiceSession(session.user.id, companionVoice);
  } catch {
    return jsonError(
      "VOICE_QUOTA_EXHAUSTED",
      session.user.accountType === "guest"
        ? "访客体验时间已经用完，请在微信中继续使用。"
        : "今天的语音时间已经用完，明天再来聊聊。",
      429,
    );
  }

  try {
    const issued = createVoiceWorkerToken(
      session.user.id,
      reservation.sessionId,
      companionVoice,
      reservation.quotaSeconds,
    );
    await recordUsage(session.user.id, "realtimeConnections");
    return Response.json(
      {
        token: issued.token,
        expiresAt: issued.expiresAt,
        websocketPath: "/voice-ws",
        remainingSeconds: reservation.quotaSeconds,
        inputAudio: { format: "pcm_s16le", sampleRate: 16_000, channels: 1 },
        outputAudio: { format: "pcm_s16le", sampleRate: 24_000, channels: 1 },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    await cancelVoiceReservation(session.user.id, reservation.sessionId);
    return jsonError(
      "VOICE_WORKER_NOT_CONFIGURED",
      "语音服务正在准备中，请稍后再试。",
      503,
    );
  }
}
