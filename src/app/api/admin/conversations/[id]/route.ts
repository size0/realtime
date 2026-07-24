import { getRequestSession, validCsrfToken } from "@/lib/auth-session";
import { adminReadConversation } from "@/lib/conversation-store";
import { hasSameOrigin, jsonError } from "@/lib/request-security";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 2 * 1024;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!hasSameOrigin(request)) {
    return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  }
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  if (session.user.role !== "admin") {
    return jsonError("FORBIDDEN", "仅管理员可以查看对话。", 403);
  }
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "页面会话已过期，请刷新后重试。", 403);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return jsonError("INVALID_REASON", "查看原因过长。", 413);
  }
  let reason = "";
  try {
    const body: unknown = JSON.parse(raw);
    if (typeof body === "object" && body !== null) {
      const value = (body as Record<string, unknown>).reason;
      if (typeof value === "string") reason = value.trim();
    }
  } catch {
    return jsonError("INVALID_REASON", "请填写查看原因。", 400);
  }
  if (reason.length < 2 || reason.length > 120) {
    return jsonError("INVALID_REASON", "查看原因需要 2 到 120 个字符。", 400);
  }
  const { id } = await context.params;
  try {
    const conversation = adminReadConversation(session.user.id, id, reason);
    return conversation
      ? Response.json(
          { conversation },
          { headers: { "Cache-Control": "no-store" } },
        )
      : jsonError("NOT_FOUND", "对话不存在。", 404);
  } catch {
    return jsonError("CONVERSATION_UNAVAILABLE", "暂时无法查看这段对话。", 503);
  }
}
