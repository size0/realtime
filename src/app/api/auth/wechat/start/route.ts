import { getRequestSession } from "@/lib/auth-session";
import {
  createWechatAuthorizeUrl,
  createWechatOauthTransaction,
  WechatOauthError,
} from "@/lib/wechat-oauth";

export const runtime = "nodejs";
export const WECHAT_STATE_COOKIE = "wechat_oauth_state";

export async function GET(request: Request): Promise<Response> {
  const session = await getRequestSession(request);
  const returnTo = new URL(request.url).searchParams.get("returnTo") || "/";
  try {
    const transaction = createWechatOauthTransaction(
      session?.user.accountType === "guest" ? session.user.id : null,
      returnTo,
    );
    const response = Response.redirect(createWechatAuthorizeUrl(transaction.state), 303);
    response.headers.append(
      "Set-Cookie",
      `${WECHAT_STATE_COOKIE}=${transaction.state}; Path=/api/auth/wechat/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: unknown) {
    const message =
      error instanceof WechatOauthError
        ? error.message
        : "微信登录暂时不可用，请稍后重试。";
    return new Response(message, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
