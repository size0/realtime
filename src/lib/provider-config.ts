import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { database } from "@/lib/database";
import {
  isValidWorkspaceId,
  type QwenRegion,
} from "@/lib/realtime-session";

export type SecretUpdate =
  | { action: "keep" }
  | { action: "clear" }
  | { action: "replace"; value: string };

export interface SecretView {
  configured: boolean;
  last4: string | null;
}

export interface ProviderPricing {
  asrPerHour: number;
  ttsPer10kChars: number;
  economyInputPerMillionTokens: number;
  economyOutputPerMillionTokens: number;
  strongInputPerMillionTokens: number;
  strongOutputPerMillionTokens: number;
  realtimeAudioInputPerMillionTokens: number;
  realtimeAudioOutputPerMillionTokens: number;
  currency: "CNY";
}

export interface ProviderConfig {
  wechat: {
    enabled: boolean;
    appId: string;
    appSecret: string;
    redirectUri: string;
  };
  economyModel: {
    provider: string;
    baseUrl: string;
    apiKey: string;
  };
  strongModel: {
    provider: string;
    baseUrl: string;
    apiKey: string;
  };
  dashscope: {
    apiKey: string;
    workspaceId: string;
    region: QwenRegion;
    ttsWsUrl: string;
  };
  pricing: ProviderPricing;
}

export interface ProviderConfigView {
  wechat: Omit<ProviderConfig["wechat"], "appSecret"> & {
    appSecret: SecretView;
  };
  economyModel: Omit<ProviderConfig["economyModel"], "apiKey"> & {
    apiKey: SecretView;
  };
  strongModel: Omit<ProviderConfig["strongModel"], "apiKey"> & {
    apiKey: SecretView;
  };
  dashscope: Omit<ProviderConfig["dashscope"], "apiKey"> & {
    apiKey: SecretView;
  };
  pricing: ProviderPricing;
}

export interface ProviderConfigUpdate {
  wechat?: {
    enabled?: boolean;
    appId?: string;
    appSecret?: SecretUpdate;
    redirectUri?: string;
  };
  economyModel?: {
    provider?: string;
    baseUrl?: string;
    apiKey?: SecretUpdate;
  };
  strongModel?: {
    provider?: string;
    baseUrl?: string;
    apiKey?: SecretUpdate;
  };
  dashscope?: {
    apiKey?: SecretUpdate;
    workspaceId?: string;
    region?: QwenRegion;
    ttsWsUrl?: string;
  };
  pricing?: Partial<ProviderPricing>;
}

interface StoredProviderPublicConfig {
  wechat: Omit<ProviderConfig["wechat"], "appSecret">;
  economyModel: Omit<ProviderConfig["economyModel"], "apiKey">;
  strongModel: Omit<ProviderConfig["strongModel"], "apiKey">;
  dashscope: Omit<ProviderConfig["dashscope"], "apiKey">;
  pricing: ProviderPricing;
}

interface SecretRow {
  ciphertext: string;
  iv: string;
  auth_tag: string;
}

const PUBLIC_CONFIG_KEY = "provider_config_public_v1";
const SECRET_KEYS = {
  wechatAppSecret: "wechat.app_secret",
  economyApiKey: "economy.api_key",
  strongApiKey: "strong.api_key",
  dashscopeApiKey: "dashscope.api_key",
} as const;
const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const WECHAT_APP_ID_PATTERN = /^wx[A-Za-z0-9]{16}$/;
const MAX_SECRET_LENGTH = 1024;
const MAX_PRICE = 1_000_000;

function decodeRootKey(value: string): Buffer {
  const decoded = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error("Provider configuration encryption key must decode to 32 bytes.");
  }
  return decoded;
}

function encryptionKey(): Buffer {
  const value =
    process.env.PROVIDER_CONFIG_ENCRYPTION_KEY?.trim() ||
    process.env.MESSAGE_ENCRYPTION_KEY?.trim();
  if (!value) {
    throw new Error(
      "PROVIDER_CONFIG_ENCRYPTION_KEY or MESSAGE_ENCRYPTION_KEY is not configured.",
    );
  }
  return decodeRootKey(value);
}

function encryptSecret(value: string): {
  ciphertext: string;
  iv: string;
  authTag: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptSecret(row: SecretRow): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(row.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function envFirst(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function defaultPublicConfig(): StoredProviderPublicConfig {
  const regionValue = process.env.DASHSCOPE_REGION?.trim();
  const region: QwenRegion =
    regionValue === "ap-southeast-1" ? regionValue : "cn-beijing";
  return {
    wechat: {
      enabled: process.env.WECHAT_LOGIN_ENABLED !== "false",
      appId: envFirst("WECHAT_OFFICIAL_ACCOUNT_APP_ID"),
      redirectUri:
        envFirst("WECHAT_OAUTH_REDIRECT_URI") ||
        "https://voice.xdw0.cn/api/auth/wechat/callback",
    },
    economyModel: {
      provider: "openai-compatible",
      baseUrl: envFirst(
        "ECONOMY_REASONING_BASE_URL",
        "DASHSCOPE_TEXT_BASE_URL",
      ),
    },
    strongModel: {
      provider: "openai-compatible",
      baseUrl: envFirst(
        "STRONG_REASONING_BASE_URL",
        "REASONING_BASE_URL",
        "DASHSCOPE_TEXT_BASE_URL",
      ),
    },
    dashscope: {
      workspaceId: envFirst("DASHSCOPE_WORKSPACE_ID"),
      region,
      ttsWsUrl:
        envFirst("VOICE_TTS_WS_URL") ||
        "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
    },
    pricing: {
      asrPerHour: 0,
      ttsPer10kChars: 0,
      economyInputPerMillionTokens: 0,
      economyOutputPerMillionTokens: 0,
      strongInputPerMillionTokens: 0,
      strongOutputPerMillionTokens: 0,
      realtimeAudioInputPerMillionTokens: 0,
      realtimeAudioOutputPerMillionTokens: 0,
      currency: "CNY",
    },
  };
}

function readPublicConfig(): StoredProviderPublicConfig {
  const defaults = defaultPublicConfig();
  const row = database()
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(PUBLIC_CONFIG_KEY) as { value: string } | undefined;
  if (!row) return defaults;
  try {
    const parsed = JSON.parse(row.value) as Partial<StoredProviderPublicConfig>;
    return {
      wechat: { ...defaults.wechat, ...parsed.wechat },
      economyModel: { ...defaults.economyModel, ...parsed.economyModel },
      strongModel: { ...defaults.strongModel, ...parsed.strongModel },
      dashscope: { ...defaults.dashscope, ...parsed.dashscope },
      pricing: { ...defaults.pricing, ...parsed.pricing, currency: "CNY" },
    };
  } catch {
    return defaults;
  }
}

function readStoredSecret(key: string): string | null {
  const row = database()
    .prepare(
      "SELECT ciphertext, iv, auth_tag FROM provider_secrets WHERE key = ?",
    )
    .get(key) as SecretRow | undefined;
  return row ? decryptSecret(row) : null;
}

function secretWithEnvironmentFallback(
  key: string,
  environmentNames: string[],
): string {
  const stored = readStoredSecret(key);
  return stored === null ? envFirst(...environmentNames) : stored;
}

function secretView(value: string): SecretView {
  return {
    configured: value.length > 0,
    last4: value.length > 0 ? value.slice(-4) : null,
  };
}

export function getProviderConfig(): ProviderConfig {
  const publicConfig = readPublicConfig();
  return {
    wechat: {
      ...publicConfig.wechat,
      appSecret: secretWithEnvironmentFallback(
        SECRET_KEYS.wechatAppSecret,
        ["WECHAT_OFFICIAL_ACCOUNT_APP_SECRET"],
      ),
    },
    economyModel: {
      ...publicConfig.economyModel,
      apiKey: secretWithEnvironmentFallback(
        SECRET_KEYS.economyApiKey,
        ["ECONOMY_REASONING_API_KEY", "DASHSCOPE_API_KEY"],
      ),
    },
    strongModel: {
      ...publicConfig.strongModel,
      apiKey: secretWithEnvironmentFallback(
        SECRET_KEYS.strongApiKey,
        ["STRONG_REASONING_API_KEY", "REASONING_API_KEY", "DASHSCOPE_API_KEY"],
      ),
    },
    dashscope: {
      ...publicConfig.dashscope,
      apiKey: secretWithEnvironmentFallback(
        SECRET_KEYS.dashscopeApiKey,
        ["DASHSCOPE_API_KEY"],
      ),
    },
    pricing: publicConfig.pricing,
  };
}

export function getProviderConfigView(): ProviderConfigView {
  const config = getProviderConfig();
  return {
    wechat: {
      enabled: config.wechat.enabled,
      appId: config.wechat.appId,
      redirectUri: config.wechat.redirectUri,
      appSecret: secretView(config.wechat.appSecret),
    },
    economyModel: {
      provider: config.economyModel.provider,
      baseUrl: config.economyModel.baseUrl,
      apiKey: secretView(config.economyModel.apiKey),
    },
    strongModel: {
      provider: config.strongModel.provider,
      baseUrl: config.strongModel.baseUrl,
      apiKey: secretView(config.strongModel.apiKey),
    },
    dashscope: {
      workspaceId: config.dashscope.workspaceId,
      region: config.dashscope.region,
      ttsWsUrl: config.dashscope.ttsWsUrl,
      apiKey: secretView(config.dashscope.apiKey),
    },
    pricing: config.pricing,
  };
}

function validHttpsUrl(value: string, allowEmpty = true): boolean {
  if (!value) return allowEmpty;
  if (value.length > 2048) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validWebsocketUrl(value: string): boolean {
  if (!value || value.length > 2048) return false;
  try {
    return new URL(value).protocol === "wss:";
  } catch {
    return false;
  }
}

function validSecretUpdate(value: SecretUpdate | undefined): boolean {
  if (!value) return true;
  if (value.action === "keep" || value.action === "clear") return true;
  return (
    value.action === "replace" &&
    typeof value.value === "string" &&
    value.value === value.value.trim() &&
    value.value.length >= 8 &&
    value.value.length <= MAX_SECRET_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value.value)
  );
}

function validPrice(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_PRICE
  );
}

function validateUpdate(input: ProviderConfigUpdate): void {
  const groups: unknown[] = [
    input.wechat,
    input.economyModel,
    input.strongModel,
    input.dashscope,
    input.pricing,
  ];
  if (
    groups.some(
      (group) =>
        group !== undefined &&
        (typeof group !== "object" || group === null || Array.isArray(group)),
    ) ||
    (input.wechat?.enabled !== undefined &&
      typeof input.wechat.enabled !== "boolean") ||
    (input.wechat?.appId !== undefined &&
      input.wechat.appId !== "" &&
      !WECHAT_APP_ID_PATTERN.test(input.wechat.appId)) ||
    (input.wechat?.redirectUri !== undefined &&
      !validHttpsUrl(input.wechat.redirectUri, false)) ||
    !validSecretUpdate(input.wechat?.appSecret) ||
    (input.economyModel?.provider !== undefined &&
      !PROVIDER_PATTERN.test(input.economyModel.provider)) ||
    (input.economyModel?.baseUrl !== undefined &&
      !validHttpsUrl(input.economyModel.baseUrl)) ||
    !validSecretUpdate(input.economyModel?.apiKey) ||
    (input.strongModel?.provider !== undefined &&
      !PROVIDER_PATTERN.test(input.strongModel.provider)) ||
    (input.strongModel?.baseUrl !== undefined &&
      !validHttpsUrl(input.strongModel.baseUrl)) ||
    !validSecretUpdate(input.strongModel?.apiKey) ||
    (input.dashscope?.workspaceId !== undefined &&
      input.dashscope.workspaceId !== "" &&
      !isValidWorkspaceId(input.dashscope.workspaceId)) ||
    (input.dashscope?.region !== undefined &&
      input.dashscope.region !== "cn-beijing" &&
      input.dashscope.region !== "ap-southeast-1") ||
    (input.dashscope?.ttsWsUrl !== undefined &&
      !validWebsocketUrl(input.dashscope.ttsWsUrl)) ||
    !validSecretUpdate(input.dashscope?.apiKey) ||
    (input.pricing !== undefined &&
      Object.entries(input.pricing).some(
        ([key, value]) =>
          key !== "currency" && value !== undefined && !validPrice(value),
      )) ||
    (input.pricing?.currency !== undefined &&
      input.pricing.currency !== "CNY")
  ) {
    throw new Error("Invalid provider configuration.");
  }
}

function applySecretUpdate(
  key: string,
  update: SecretUpdate | undefined,
  adminId: string,
  now: number,
): void {
  if (!update || update.action === "keep") return;
  const db = database();
  if (update.action === "clear") {
    const encrypted = encryptSecret("");
    db.prepare(`
      INSERT INTO provider_secrets(
        key, ciphertext, iv, auth_tag, key_version, updated_by, updated_at
      ) VALUES(?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        key_version = excluded.key_version,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      key,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      adminId,
      now,
    );
    return;
  }
  const encrypted = encryptSecret(update.value);
  db.prepare(`
    INSERT INTO provider_secrets(
      key, ciphertext, iv, auth_tag, key_version, updated_by, updated_at
    ) VALUES(?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      auth_tag = excluded.auth_tag,
      key_version = excluded.key_version,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(
    key,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.authTag,
    adminId,
    now,
  );
}

export function updateProviderConfig(
  adminId: string,
  input: ProviderConfigUpdate,
): ProviderConfigView {
  validateUpdate(input);
  const current = readPublicConfig();
  const next: StoredProviderPublicConfig = {
    wechat: { ...current.wechat, ...input.wechat },
    economyModel: { ...current.economyModel, ...input.economyModel },
    strongModel: { ...current.strongModel, ...input.strongModel },
    dashscope: { ...current.dashscope, ...input.dashscope },
    pricing: { ...current.pricing, ...input.pricing, currency: "CNY" },
  };
  delete (next.wechat as Record<string, unknown>).appSecret;
  delete (next.economyModel as Record<string, unknown>).apiKey;
  delete (next.strongModel as Record<string, unknown>).apiKey;
  delete (next.dashscope as Record<string, unknown>).apiKey;

  const db = database();
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO app_settings(key, value, updated_by, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(PUBLIC_CONFIG_KEY, JSON.stringify(next), adminId, now);
    applySecretUpdate(
      SECRET_KEYS.wechatAppSecret,
      input.wechat?.appSecret,
      adminId,
      now,
    );
    applySecretUpdate(
      SECRET_KEYS.economyApiKey,
      input.economyModel?.apiKey,
      adminId,
      now,
    );
    applySecretUpdate(
      SECRET_KEYS.strongApiKey,
      input.strongModel?.apiKey,
      adminId,
      now,
    );
    applySecretUpdate(
      SECRET_KEYS.dashscopeApiKey,
      input.dashscope?.apiKey,
      adminId,
      now,
    );
    db.prepare(`
      INSERT INTO admin_audit_logs(
        id, admin_id, action, target_id, reason, created_at
      ) VALUES(?, ?, 'provider_config.update', 'providers', ?, ?)
    `).run(
      randomUUID(),
      adminId,
      "更新供应商、公众号或价格配置",
      now,
    );
  })();
  return getProviderConfigView();
}
