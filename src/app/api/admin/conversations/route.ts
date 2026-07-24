import { getRequestSession } from "@/lib/auth-session";
import {
  listAdminAuditLogs,
  listAdminConversations,
} from "@/lib/conversation-store";
import { jsonError } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const session = await getRequestSession(request);
  if (!session) return jsonError("UNAUTHENTICATED", "请先登录。", 401);
  if (session.user.role !== "admin") {
    return jsonError("FORBIDDEN", "仅管理员可以访问。", 403);
  }
  return Response.json(
    {
      conversations: listAdminConversations(),
      auditLogs: listAdminAuditLogs(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
