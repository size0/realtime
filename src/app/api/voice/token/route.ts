import { getRequestSession, validCsrfToken } from "@/lib/auth-session";
import { recordUsage, usageAllowance } from "@/lib/auth-store";
import { checkConnectionRateLimit } from "@/lib/rate-limit";
import {
  hasSameOrigin,
  jsonError,
  requestClientIdentifier,
} from "@/lib/request-security";
import { createVoiceWorkerToken } from "@/lib/voice-token";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) {
    return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  }

  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "页面会话已过期，请刷新后重试。", 403);
  }

  const rateLimit = checkConnectionRateLimit(
    `${requestClientIdentifier(request)}:${session.user.id}:split`,
  );
  if (!rateLimit.allowed) {
    return jsonError("RATE_LIMITED", "语音连接请求过于频繁。", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  const allowance = usageAllowance(session.user, "realtimeConnections");
  if (!allowance.allowed) {
    return jsonError(
      "GUEST_DAILY_LIMIT",
      `今日访客语音连接额度已用完（${allowance.limit} 次），请明天再试。`,
      429,
    );
  }

  try {
    const issued = createVoiceWorkerToken(session.user.id);
    await recordUsage(session.user.id, "realtimeConnections");
    return Response.json(
      {
        token: issued.token,
        expiresAt: issued.expiresAt,
        websocketPath: "/voice-ws",
        inputAudio: {
          format: "pcm_s16le",
          sampleRate: 16_000,
          channels: 1,
        },
        outputAudio: {
          format: "pcm_s16le",
          sampleRate: 24_000,
          channels: 1,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return jsonError(
      "VOICE_WORKER_NOT_CONFIGURED",
      "低成本语音服务尚未完成安全配置，请切换高保真模式。",
      503,
    );
  }
}

