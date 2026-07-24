import { getRequestSession, validCsrfToken } from "@/lib/auth-session";
import {
  createConversation,
  deleteAllConversations,
  listConversations,
} from "@/lib/conversation-store";
import { hasSameOrigin, jsonError } from "@/lib/request-security";
import { isCompanionVoice } from "@/types/product";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  return Response.json(
    { conversations: listConversations(session.user.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "页面会话已过期，请刷新后重试。", 403);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_CONVERSATION", "会话请求格式无效。", 400);
  }
  const voice =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).companionVoice
      : null;
  if (!isCompanionVoice(voice)) {
    return jsonError("INVALID_CONVERSATION", "陪伴角色无效。", 400);
  }
  return Response.json(
    { conversation: createConversation(session.user.id, voice) },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "页面会话已过期，请刷新后重试。", 403);
  }
  return Response.json({ deleted: deleteAllConversations(session.user.id) });
}
