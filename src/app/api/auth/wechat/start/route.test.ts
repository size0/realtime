import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDatabaseForTests } from "@/lib/database";
import { GET, WECHAT_STATE_COOKIE } from "@/app/api/auth/wechat/start/route";

describe("GET /api/auth/wechat/start", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "wechat-start-route-"));
    process.env.APP_DATABASE_FILE = path.join(directory, "app.sqlite");
    process.env.APP_DATA_FILE = path.join(directory, "missing.json");
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.WECHAT_OFFICIAL_ACCOUNT_APP_ID = "wx1234567890abcdef";
    process.env.WECHAT_OFFICIAL_ACCOUNT_APP_SECRET = "test-wechat-secret";
    process.env.WECHAT_OAUTH_REDIRECT_URI =
      "https://voice.example.com/api/auth/wechat/callback";
    resetDatabaseForTests();
  });

  afterEach(async () => {
    resetDatabaseForTests();
    delete process.env.APP_DATABASE_FILE;
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.WECHAT_OFFICIAL_ACCOUNT_APP_ID;
    delete process.env.WECHAT_OFFICIAL_ACCOUNT_APP_SECRET;
    delete process.env.WECHAT_OAUTH_REDIRECT_URI;
    await rm(directory, { recursive: true, force: true });
  });

  it("redirects to WeChat with a writable state cookie", async () => {
    const response = await GET(
      new Request("https://voice.example.com/api/auth/wechat/start?returnTo=/"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "https://open.weixin.qq.com/connect/oauth2/authorize",
    );
    expect(response.headers.get("location")).toContain("scope=snsapi_base");
    expect(response.headers.get("set-cookie")).toContain(`${WECHAT_STATE_COOKIE}=`);
  });
});
