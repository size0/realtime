import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabaseForTests } from "@/lib/database";
import {
  consumeWechatOauthTransaction,
  createWechatAuthorizeUrl,
  createWechatOauthTransaction,
  exchangeWechatCode,
  resetWechatOauthForTests,
} from "@/lib/wechat-oauth";

describe("WeChat Official Account OAuth", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "wechat-oauth-"));
    process.env.APP_DATABASE_FILE = path.join(directory, "app.sqlite");
    process.env.APP_DATA_FILE = path.join(directory, "missing.json");
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.WECHAT_OFFICIAL_ACCOUNT_APP_ID = "wx1234567890abcdef";
    process.env.WECHAT_OFFICIAL_ACCOUNT_APP_SECRET = "test-wechat-secret";
    process.env.WECHAT_OAUTH_REDIRECT_URI = "https://voice.example.com/api/auth/wechat/callback";
    resetDatabaseForTests();
    resetWechatOauthForTests();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    resetWechatOauthForTests();
    resetDatabaseForTests();
    delete process.env.APP_DATABASE_FILE;
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.WECHAT_OFFICIAL_ACCOUNT_APP_ID;
    delete process.env.WECHAT_OFFICIAL_ACCOUNT_APP_SECRET;
    delete process.env.WECHAT_OAUTH_REDIRECT_URI;
    await rm(directory, { recursive: true, force: true });
  });

  it("creates a silent snsapi_base URL and consumes state exactly once", () => {
    const transaction = createWechatOauthTransaction("guest-1", "/?from=wechat", 1_000);
    const url = new URL(createWechatAuthorizeUrl(transaction.state));
    expect(url.origin).toBe("https://open.weixin.qq.com");
    expect(url.searchParams.get("scope")).toBe("snsapi_base");
    expect(url.searchParams.get("state")).toBe(transaction.state);
    expect(url.toString()).toContain("#wechat_redirect");

    expect(consumeWechatOauthTransaction(transaction.state, 1_001)).toMatchObject({
      guestUserId: "guest-1",
      returnTo: "/?from=wechat",
    });
    expect(consumeWechatOauthTransaction(transaction.state, 1_002)).toBeNull();
  });

  it("rejects unsafe return paths and expired transactions", () => {
    const transaction = createWechatOauthTransaction(null, "https://attacker.example", 2_000);
    expect(consumeWechatOauthTransaction(transaction.state, 2_001)?.returnTo).toBe("/");

    const expired = createWechatOauthTransaction(null, "/", 5_000);
    expect(consumeWechatOauthTransaction(expired.state, 5_000 + 10 * 60 * 1000 + 1))
      .toBeNull();
  });

  it("maps a successful code exchange without exposing upstream errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: "temporary-token",
      expires_in: 7200,
      refresh_token: "refresh",
      openid: "openid-123",
      scope: "snsapi_base",
    }), { status: 200 })));
    await expect(exchangeWechatCode("valid-code")).resolves.toEqual({
      openId: "openid-123",
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      errcode: 40029,
      errmsg: "invalid code containing provider internals",
    }), { status: 200 })));
    await expect(exchangeWechatCode("bad-code")).rejects.toMatchObject({
      code: "WECHAT_CODE_INVALID",
    });
  });
});
