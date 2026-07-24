import { getRequestSession, validCsrfToken } from "@/lib/auth-session";
import { addConversationMessages } from "@/lib/conversation-store";
import { hasSameOrigin, jsonError } from "@/lib/request-security";
import type { TranscriptMessage } from "@/types/realtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "页面会话已过期，请刷新后重试。", 403);
  }
  const body: unknown = await request.json().catch(() => null);
  const messages =
    typeof body === "object" && body !== null && Array.isArray(
      (body as Record<string, unknown>).messages,
    )
      ? (body as { messages: TranscriptMessage[] }).messages
      : null;
  if (!messages) return jsonError("INVALID_MESSAGES", "消息请求格式无效。", 400);
  const { id } = await context.params;
  try {
    return Response.json({
      stored: addConversationMessages(session.user.id, id, messages),
    });
  } catch {
    return jsonError("INVALID_MESSAGES", "消息无效或对话不存在。", 400);
  }
}
