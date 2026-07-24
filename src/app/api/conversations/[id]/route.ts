import { getRequestSession, validCsrfToken } from "@/lib/auth-session";
import {
  deleteConversation,
  getConversation,
  updateConversation,
} from "@/lib/conversation-store";
import { hasSameOrigin, jsonError } from "@/lib/request-security";
import type { ConversationStatus } from "@/types/product";

const STATUSES: ConversationStatus[] = ["active", "completed", "interrupted", "failed"];
type RouteParams = { params: Promise<{ id: string }> };

export async function GET(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  const { id } = await context.params;
  const conversation = getConversation(session.user.id, id);
  return conversation
    ? Response.json({ conversation }, { headers: { "Cache-Control": "no-store" } })
    : jsonError("NOT_FOUND", "对话不存在。", 404);
}

export async function PATCH(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "页面会话已过期，请刷新后重试。", 403);
  }
  const body: unknown = await request.json().catch(() => null);
  const status =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).status
      : null;
  if (typeof status !== "string" || !STATUSES.includes(status as ConversationStatus)) {
    return jsonError("INVALID_STATUS", "会话状态无效。", 400);
  }
  const { id } = await context.params;
  return updateConversation(session.user.id, id, { status: status as ConversationStatus })
    ? Response.json({ updated: true })
    : jsonError("NOT_FOUND", "对话不存在。", 404);
}

export async function DELETE(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "页面会话已过期，请刷新后重试。", 403);
  }
  const { id } = await context.params;
  return deleteConversation(session.user.id, id)
    ? Response.json({ deleted: true })
    : jsonError("NOT_FOUND", "对话不存在。", 404);
}
