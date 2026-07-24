import {
  requireAdmin,
  requireAdminMutation,
} from "@/lib/admin-request";
import {
  getProductSettings,
  updateProductSettings,
} from "@/lib/product-admin";
import { jsonError } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  return Response.json(
    { settings: getProductSettings() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  const blocked = requireAdminMutation(request, auth.session);
  if (blocked) return blocked;
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return jsonError("INVALID_SETTINGS", "产品参数格式无效。", 400);
  }
  const input = body as Record<string, unknown>;
  try {
    return Response.json({
      settings: updateProductSettings(auth.session.user.id, {
        guestTrialSeconds:
          typeof input.guestTrialSeconds === "number"
            ? input.guestTrialSeconds
            : undefined,
        wechatDailySeconds:
          typeof input.wechatDailySeconds === "number"
            ? input.wechatDailySeconds
            : undefined,
        vadSilenceMs:
          typeof input.vadSilenceMs === "number"
            ? input.vadSilenceMs
            : undefined,
        defaultCompanion:
          typeof input.defaultCompanion === "string"
            ? input.defaultCompanion as never
            : undefined,
      }),
    });
  } catch {
    return jsonError("INVALID_SETTINGS", "产品参数超出允许范围。", 400);
  }
}
