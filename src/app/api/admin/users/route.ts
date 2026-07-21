import {
  AuthStoreError,
  createUser,
  listUsers,
  setUserEnabled,
  type UserRole,
} from "@/lib/auth-store";
import { getRequestSession, validCsrfToken, type AuthSession } from "@/lib/auth-session";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import {
  hasSameOrigin,
  jsonError,
  requestClientIdentifier,
} from "@/lib/request-security";

export const runtime = "nodejs";

const MAX_ADMIN_BODY_BYTES = 8 * 1024;

function unauthorized() {
  return jsonError("UNAUTHENTICATED", "请先登录。", 401);
}

type AdminAuthResult = { response: Response } | { session: AuthSession };

async function requireAdmin(request: Request): Promise<AdminAuthResult> {
  const session = await getRequestSession(request);
  if (!session) return { response: unauthorized() } as const;
  if (session.user.role !== "admin") {
    return { response: jsonError("FORBIDDEN", "仅管理员可以访问。", 403) } as const;
  }
  return { session } as const;
}

async function readJsonBody(request: Request): Promise<unknown | null> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_ADMIN_BODY_BYTES) return null;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_ADMIN_BODY_BYTES) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readCreateInput(value: unknown): {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
} | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.username !== "string" ||
    typeof body.displayName !== "string" ||
    typeof body.password !== "string"
  ) {
    return null;
  }
  const role = body.role === "admin" ? "admin" : "user";
  return {
    username: body.username,
    displayName: body.displayName,
    password: body.password,
    role,
  };
}

function readUpdateInput(value: unknown): { id: string; enabled: boolean } | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  return typeof body.id === "string" && typeof body.enabled === "boolean"
    ? { id: body.id, enabled: body.enabled }
    : null;
}

function mutationAllowed(request: Request, session: AuthSession): Response | null {
  if (!hasSameOrigin(request)) return jsonError("INVALID_ORIGIN", "请求来源不匹配。", 403);
  if (!validCsrfToken(session, request.headers.get("x-csrf-token"))) {
    return jsonError("INVALID_CSRF", "安全令牌无效，请刷新页面后重试。", 403);
  }
  const rateLimit = checkAdminMutationRateLimit(requestClientIdentifier(request));
  return rateLimit.allowed
    ? null
    : jsonError("ADMIN_RATE_LIMITED", "后台操作过于频繁，请稍后再试。", 429, {
        "Retry-After": String(rateLimit.retryAfterSeconds),
      });
}

function storeError(error: AuthStoreError): Response {
  const status = error.code === "USER_EXISTS" ? 409 : error.code === "USER_NOT_FOUND" ? 404 : 400;
  return jsonError(error.code, error.message, status);
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  return Response.json({ users: await listUsers() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  const blocked = mutationAllowed(request, auth.session);
  if (blocked) return blocked;
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    return jsonError("INVALID_USER", "请求格式无效。", 415);
  }

  try {
    const input = readCreateInput(await readJsonBody(request));
    if (!input) return jsonError("INVALID_USER", "用户资料格式无效。", 400);
    const user = await createUser(input);
    return Response.json({ user }, { status: 201 });
  } catch (error: unknown) {
    return error instanceof AuthStoreError
      ? storeError(error)
      : jsonError("AUTH_UNAVAILABLE", "用户服务暂时不可用。", 503);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  const blocked = mutationAllowed(request, auth.session);
  if (blocked) return blocked;

  try {
    const input = readUpdateInput(await readJsonBody(request));
    if (!input) return jsonError("INVALID_USER", "用户状态格式无效。", 400);
    if (input.id === auth.session.user.id && !input.enabled) {
      return jsonError("CANNOT_DISABLE_SELF", "不能停用当前登录的管理员账号。", 400);
    }
    const user = await setUserEnabled(input.id, input.enabled);
    return Response.json({ user });
  } catch (error: unknown) {
    return error instanceof AuthStoreError
      ? storeError(error)
      : jsonError("AUTH_UNAVAILABLE", "用户服务暂时不可用。", 503);
  }
}
