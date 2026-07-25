import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDatabaseForTests } from "@/lib/database";
import {
  getProviderConfig,
  getProviderConfigView,
  updateProviderConfig,
} from "@/lib/provider-config";

describe("encrypted provider configuration", () => {
  let directory = "";
  let databaseFile = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "provider-config-"));
    databaseFile = path.join(directory, "app.sqlite");
    process.env.APP_DATABASE_FILE = databaseFile;
    process.env.MESSAGE_ENCRYPTION_KEY = "11".repeat(32);
    process.env.DASHSCOPE_API_KEY = "environment-dashscope-key";
    resetDatabaseForTests();
  });

  afterEach(async () => {
    resetDatabaseForTests();
    delete process.env.APP_DATABASE_FILE;
    delete process.env.MESSAGE_ENCRYPTION_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.WECHAT_OFFICIAL_ACCOUNT_APP_ID;
    delete process.env.WECHAT_OFFICIAL_ACCOUNT_APP_SECRET;
    await rm(directory, { recursive: true, force: true });
  });

  it("encrypts secrets and only exposes masks to the admin DTO", async () => {
    const view = updateProviderConfig("admin-1", {
      wechat: {
        enabled: true,
        appId: "wx51e5841827764029",
        appSecret: {
          action: "replace",
          value: "rotated-wechat-secret-value",
        },
        redirectUri: "https://voice.xdw0.cn/api/auth/wechat/callback",
      },
      economyModel: {
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: { action: "replace", value: "economy-secret-value" },
      },
      dashscope: {
        workspaceId: "llm-d8p0v9o7adt5q2s2",
        region: "cn-beijing",
        ttsWsUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        apiKey: { action: "replace", value: "dashscope-secret-value" },
      },
      pricing: {
        asrPerHour: 0.8,
        ttsPer10kChars: 2,
        economyInputPerMillionTokens: 0.5,
        economyOutputPerMillionTokens: 1.5,
        strongInputPerMillionTokens: 8,
        strongOutputPerMillionTokens: 24,
        realtimeAudioInputPerMillionTokens: 10,
        realtimeAudioOutputPerMillionTokens: 20,
        currency: "CNY",
      },
    });

    expect(view.wechat.appSecret).toEqual({
      configured: true,
      last4: "alue",
    });
    expect(view.dashscope.apiKey).toEqual({
      configured: true,
      last4: "alue",
    });
    expect(JSON.stringify(view)).not.toContain("secret-value");
    expect(getProviderConfig()).toMatchObject({
      wechat: { appSecret: "rotated-wechat-secret-value" },
      dashscope: { apiKey: "dashscope-secret-value" },
      pricing: { ttsPer10kChars: 2, currency: "CNY" },
    });

    resetDatabaseForTests();
    const bytes = await readFile(databaseFile);
    expect(bytes.includes(Buffer.from("rotated-wechat-secret-value"))).toBe(false);
    expect(bytes.includes(Buffer.from("dashscope-secret-value"))).toBe(false);
  });

  it("keeps, replaces and explicitly clears environment fallback secrets", () => {
    expect(getProviderConfigView().dashscope.apiKey.configured).toBe(true);
    updateProviderConfig("admin-1", {
      dashscope: { apiKey: { action: "clear" } },
    });
    expect(getProviderConfig().dashscope.apiKey).toBe("");
    expect(getProviderConfigView().dashscope.apiKey).toEqual({
      configured: false,
      last4: null,
    });
  });

  it("rejects insecure URLs and malformed price values", () => {
    expect(() =>
      updateProviderConfig("admin-1", {
        strongModel: { baseUrl: "http://insecure.example/v1" },
      }),
    ).toThrow("Invalid provider configuration");
    expect(() =>
      updateProviderConfig("admin-1", {
        pricing: { ttsPer10kChars: -1 },
      }),
    ).toThrow("Invalid provider configuration");
  });
});
