import {
  requireAdmin,
  requireAdminMutation,
} from "@/lib/admin-request";
import {
  createPromptDraft,
  listPromptVersions,
  publishPromptVersion,
} from "@/lib/product-admin";
import { jsonError } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  return Response.json(
    { versions: listPromptVersions() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  const blocked = requireAdminMutation(request, auth.session);
  if (blocked) return blocked;
  const body: unknown = await request.json().catch(() => null);
  const content =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).content
      : null;
  if (typeof content !== "string") {
    return jsonError("INVALID_PROMPT", "提示词正文无效。", 400);
  }
  try {
    return Response.json(
      { version: createPromptDraft(auth.session.user.id, content) },
      { status: 201 },
    );
  } catch (error: unknown) {
    return jsonError(
      "INVALID_PROMPT",
      error instanceof Error ? error.message : "提示词正文无效。",
      400,
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  const blocked = requireAdminMutation(request, auth.session);
  if (blocked) return blocked;
  const body: unknown = await request.json().catch(() => null);
  const id =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).id
      : null;
  if (typeof id !== "string") {
    return jsonError("INVALID_PROMPT", "提示词版本无效。", 400);
  }
  const version = publishPromptVersion(auth.session.user.id, id);
  return version
    ? Response.json({ version })
    : jsonError("NOT_FOUND", "提示词版本不存在。", 404);
}
