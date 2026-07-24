import {
  createSession,
  sessionCookie,
} from "@/lib/auth-session";
import { upgradeGuestToWechat } from "@/lib/auth-store";
import {
  consumeWechatOauthTransaction,
  exchangeWechatCode,
} from "@/lib/wechat-oauth";
import { WECHAT_STATE_COOKIE } from "@/app/api/auth/wechat/start/route";

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function failure(request: Request, code: string): Response {
  const target = new URL("/", request.url);
  target.searchParams.set("wechatError", code);
  return Response.redirect(target, 303);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookieState = cookieValue(request.headers.get("cookie"), WECHAT_STATE_COOKIE);
  if (!state || !code || !cookieState || state !== cookieState) {
    return failure(request, "state");
  }
  const transaction = consumeWechatOauthTransaction(state);
  if (!transaction) return failure(request, "expired");
  try {
    const identity = await exchangeWechatCode(code);
    const user = await upgradeGuestToWechat(transaction.guestUserId, identity.openId);
    const session = createSession(user);
    const target = new URL(transaction.returnTo, request.url);
    const response = Response.redirect(target, 303);
    response.headers.append("Set-Cookie", sessionCookie(session.token));
    response.headers.append(
      "Set-Cookie",
      `${WECHAT_STATE_COOKIE}=; Path=/api/auth/wechat/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return failure(request, "provider");
  }
}
