import { createHash, randomBytes } from "node:crypto";
import { database } from "@/lib/database";

const OAUTH_TTL_MS = 10 * 60 * 1000;
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

interface OauthRow {
  guest_user_id: string | null;
  return_to: string;
  expires_at: number;
}

export class WechatOauthError extends Error {
  constructor(
    public readonly code:
      | "WECHAT_NOT_CONFIGURED"
      | "WECHAT_CODE_INVALID"
      | "WECHAT_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "WechatOauthError";
  }
}

function config(): { appId: string; appSecret: string; redirectUri: string } {
  const appId = process.env.WECHAT_OFFICIAL_ACCOUNT_APP_ID?.trim();
  const appSecret = process.env.WECHAT_OFFICIAL_ACCOUNT_APP_SECRET?.trim();
  const redirectUri = process.env.WECHAT_OAUTH_REDIRECT_URI?.trim();
  if (!appId || !appSecret || !redirectUri) {
    throw new WechatOauthError("WECHAT_NOT_CONFIGURED", "微信登录尚未完成服务端配置。");
  }
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new WechatOauthError("WECHAT_NOT_CONFIGURED", "微信登录回调地址无效。");
  }
  if (parsed.protocol !== "https:") {
    throw new WechatOauthError("WECHAT_NOT_CONFIGURED", "微信登录回调必须使用 HTTPS。");
  }
  return { appId, appSecret, redirectUri: parsed.toString() };
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && value.length <= 512
    ? value
    : "/";
}

export function isWechatOauthConfigured(): boolean {
  try {
    config();
    return process.env.WECHAT_LOGIN_ENABLED !== "false";
  } catch {
    return false;
  }
}

export function createWechatOauthTransaction(
  guestUserId: string | null,
  returnTo: string,
  now = Date.now(),
): { state: string; expiresAt: number } {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = now + OAUTH_TTL_MS;
  database().prepare(`
    INSERT INTO oauth_transactions(state_hash, guest_user_id, return_to, expires_at, created_at)
    VALUES(?, ?, ?, ?, ?)
  `).run(stateHash(state), guestUserId, safeReturnTo(returnTo), expiresAt, now);
  return { state, expiresAt };
}

export function consumeWechatOauthTransaction(
  state: string,
  now = Date.now(),
): { guestUserId: string | null; returnTo: string } | null {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) return null;
  const db = database();
  const consume = db.transaction(() => {
    const hash = stateHash(state);
    const row = db.prepare("SELECT * FROM oauth_transactions WHERE state_hash = ?")
      .get(hash) as OauthRow | undefined;
    db.prepare("DELETE FROM oauth_transactions WHERE state_hash = ?").run(hash);
    db.prepare("DELETE FROM oauth_transactions WHERE expires_at <= ?").run(now);
    if (!row || row.expires_at <= now) return null;
    return { guestUserId: row.guest_user_id, returnTo: safeReturnTo(row.return_to) };
  });
  return consume();
}

export function createWechatAuthorizeUrl(state: string): string {
  const { appId, redirectUri } = config();
  const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
  url.searchParams.set("appid", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "snsapi_base");
  url.searchParams.set("state", state);
  url.hash = "wechat_redirect";
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function exchangeWechatCode(code: string): Promise<{ openId: string }> {
  if (!CODE_PATTERN.test(code)) {
    throw new WechatOauthError("WECHAT_CODE_INVALID", "微信授权凭证无效。");
  }
  const { appId, appSecret } = config();
  const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);
  url.searchParams.set("code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new WechatOauthError("WECHAT_UNAVAILABLE", "微信登录服务暂时不可用。");
    }
    const payload: unknown = await response.json();
    if (
      isRecord(payload) &&
      typeof payload.openid === "string" &&
      payload.openid.length >= 6 &&
      typeof payload.access_token === "string"
    ) {
      return { openId: payload.openid };
    }
    if (isRecord(payload) && typeof payload.errcode === "number") {
      throw new WechatOauthError("WECHAT_CODE_INVALID", "微信授权已失效，请重新进入。");
    }
    throw new WechatOauthError("WECHAT_UNAVAILABLE", "微信登录服务暂时不可用。");
  } catch (error: unknown) {
    if (error instanceof WechatOauthError) throw error;
    throw new WechatOauthError("WECHAT_UNAVAILABLE", "微信登录服务暂时不可用。");
  } finally {
    clearTimeout(timeout);
  }
}

export function resetWechatOauthForTests(): void {
  // Transactions are isolated by APP_DATABASE_FILE; no in-memory state is retained.
}
