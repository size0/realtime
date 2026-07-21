import { expiredSessionCookie, getRequestSession, validCsrfToken } from "@/lib/auth-session";
import { hasSameOrigin, jsonError } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  const session = await getRequestSession(request);
  if (session && !validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "安全令牌无效，请刷新页面后重试。", 403);
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": expiredSessionCookie(),
      "Cache-Control": "no-store",
    },
  });
}
