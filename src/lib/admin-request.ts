import {
  getRequestSession,
  validCsrfToken,
  type AuthSession,
} from "@/lib/auth-session";
import { hasSameOrigin, jsonError } from "@/lib/request-security";

export async function requireAdmin(
  request: Request,
): Promise<{ session: AuthSession } | { response: Response }> {
  const session = await getRequestSession(request);
  if (!session) {
    return { response: jsonError("UNAUTHENTICATED", "请先登录。", 401) };
  }
  if (session.user.role !== "admin") {
    return { response: jsonError("FORBIDDEN", "仅管理员可以访问。", 403) };
  }
  return { session };
}

export function requireAdminMutation(
  request: Request,
  session: AuthSession,
): Response | null {
  if (!hasSameOrigin(request)) {
    return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  }
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "页面会话已过期，请刷新后重试。", 403);
  }
  return null;
}
