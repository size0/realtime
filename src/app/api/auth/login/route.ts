import { authenticateUser, AuthStoreError } from "@/lib/auth-store";
import { createSession, sessionCookie } from "@/lib/auth-session";
import { checkLoginRateLimit } from "@/lib/rate-limit";
import {
  hasSameOrigin,
  jsonError,
  requestClientIdentifier,
} from "@/lib/request-security";

export const runtime = "nodejs";

const MAX_LOGIN_BYTES = 4 * 1024;

function readCredentials(value: unknown): { username: string; password: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.username !== "string" || typeof body.password !== "string") return null;
  if (body.username.length > 64 || body.password.length > 128) return null;
  return { username: body.username, password: body.password };
}

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    return jsonError("INVALID_LOGIN", "登录请求格式无效。", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_LOGIN_BYTES) {
    return jsonError("INVALID_LOGIN", "登录请求内容过大。", 413);
  }

  const rateLimit = checkLoginRateLimit(requestClientIdentifier(request));
  if (!rateLimit.allowed) {
    return jsonError("LOGIN_RATE_LIMITED", "登录尝试过于频繁，请稍后再试。", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  let credentials: { username: string; password: string } | null = null;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_LOGIN_BYTES) {
      return jsonError("INVALID_LOGIN", "登录请求内容过大。", 413);
    }
    credentials = readCredentials(JSON.parse(raw));
  } catch {
    credentials = null;
  }
  if (!credentials) return jsonError("INVALID_LOGIN", "用户名或密码格式无效。", 400);

  try {
    const user = await authenticateUser(credentials.username, credentials.password);
    if (!user) return jsonError("INVALID_CREDENTIALS", "用户名或密码错误。", 401);
    const session = createSession(user);
    return Response.json(
      { user, csrfToken: session.csrfToken },
      {
        headers: {
          "Set-Cookie": sessionCookie(session.token),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: unknown) {
    if (error instanceof AuthStoreError && error.code === "MISSING_ADMIN_PASSWORD") {
      return jsonError("AUTH_NOT_CONFIGURED", "服务端尚未完成管理员账号配置。", 503);
    }
    return jsonError("AUTH_UNAVAILABLE", "登录服务暂时不可用。", 503);
  }
}
