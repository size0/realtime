import { createSession, getRequestSession, sessionCookie } from "@/lib/auth-session";
import { AuthStoreError, createGuestUser } from "@/lib/auth-store";
import { checkGuestCreationRateLimit } from "@/lib/rate-limit";
import {
  hasSameOrigin,
  jsonError,
  requestClientIdentifier,
} from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) {
    return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  }

  const existing = await getRequestSession(request);
  if (existing) {
    return Response.json(
      { user: existing.user, csrfToken: existing.csrfToken, created: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const rateLimit = checkGuestCreationRateLimit(requestClientIdentifier(request));
  if (!rateLimit.allowed) {
    return jsonError(
      "GUEST_RATE_LIMITED",
      "这台设备创建访客账号过于频繁，请稍后再试。",
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  try {
    const user = await createGuestUser();
    const session = createSession(user);
    return Response.json(
      { user, csrfToken: session.csrfToken, created: true },
      {
        status: 201,
        headers: {
          "Set-Cookie": sessionCookie(session.token),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: unknown) {
    if (error instanceof AuthStoreError && error.code === "MISSING_ADMIN_PASSWORD") {
      return jsonError("AUTH_NOT_CONFIGURED", "服务端账号系统尚未完成配置。", 503);
    }
    return jsonError("AUTH_UNAVAILABLE", "暂时无法创建访客账号，请稍后重试。", 503);
  }
}
