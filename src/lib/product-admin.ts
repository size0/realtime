import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { getActiveCompanionPrompt } from "@/lib/conversation-store";
import {
  isCompanionVoice,
  type CompanionVoice,
} from "@/types/product";
import {
  DEFAULT_QWEN_REALTIME_MODEL,
  isQwenRealtimeModel,
  type QwenRealtimeModel,
} from "@/lib/realtime-session";

export type AsrProvider = "sensevoice-local";
export type TtsProvider = "qwen3-realtime";

export interface ProductSettings {
  guestTrialSeconds: number;
  wechatDailySeconds: number;
  vadSilenceMs: number;
  vadThreshold: number;
  speechPadMs: number;
  defaultCompanion: CompanionVoice;
  economyModel: string;
  economyFallbackModel: string;
  strongModel: string;
  strongFallbackModel: string;
  asrProvider: AsrProvider;
  asrModel: string;
  ttsProvider: TtsProvider;
  ttsModel: string;
  highFidelityEnabled: boolean;
  highFidelityModel: QwenRealtimeModel;
}

export interface PromptVersion {
  id: string;
  content: string;
  status: "draft" | "active" | "archived";
  createdBy: string | null;
  createdAt: number;
  publishedAt: number | null;
}

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$/;
const DEFAULT_ASR_MODEL = "FunAudioLLM/SenseVoiceSmall";
const DEFAULT_TTS_MODEL = "qwen3-tts-instruct-flash-realtime";

export function isModelAlias(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" &&
    ((allowEmpty && value === "") || MODEL_PATTERN.test(value));
}

function environmentModel(
  values: Array<string | undefined>,
  fallback: string,
  allowEmpty = false,
): string {
  const value = values.find((candidate) => candidate !== undefined)?.trim();
  return isModelAlias(value, allowEmpty) ? value : fallback;
}

function defaultSettings(): ProductSettings {
  const realtimeModel = process.env.DASHSCOPE_REALTIME_MODEL?.trim() ?? "";
  const dedicatedStrongProvider = Boolean(
    process.env.STRONG_REASONING_API_KEY?.trim() ||
      process.env.STRONG_REASONING_BASE_URL?.trim() ||
      process.env.STRONG_REASONING_MODEL?.trim() ||
      process.env.REASONING_API_KEY?.trim() ||
      process.env.REASONING_BASE_URL?.trim() ||
      process.env.REASONING_MODEL?.trim(),
  );
  return {
    guestTrialSeconds: 180,
    wechatDailySeconds: 600,
    vadSilenceMs: 1100,
    vadThreshold: environmentNumber("VOICE_VAD_THRESHOLD", 0.5, 0.1, 0.95),
    speechPadMs: environmentNumber("VOICE_SPEECH_PAD_MS", 160, 0, 1000),
    defaultCompanion: "breeze",
    economyModel: environmentModel(
      [process.env.ECONOMY_REASONING_MODEL],
      "qwen3.5-flash",
    ),
    economyFallbackModel: environmentModel(
      [process.env.ECONOMY_REASONING_FALLBACK_MODEL],
      "",
      true,
    ),
    strongModel: environmentModel(
      [
        process.env.STRONG_REASONING_MODEL,
        process.env.REASONING_MODEL,
        process.env.DASHSCOPE_REASONING_MODEL,
      ],
      "qwen3.7-max",
    ),
    strongFallbackModel: environmentModel(
      [
        process.env.STRONG_REASONING_FALLBACK_MODEL,
        process.env.REASONING_FALLBACK_MODEL,
        dedicatedStrongProvider
          ? ""
          : process.env.DASHSCOPE_REASONING_FALLBACK_MODEL,
      ],
      dedicatedStrongProvider ? "" : "qwen3.7-plus",
      true,
    ),
    asrProvider: "sensevoice-local",
    asrModel: environmentModel(
      [process.env.VOICE_ASR_MODEL],
      DEFAULT_ASR_MODEL,
    ),
    ttsProvider: "qwen3-realtime",
    ttsModel: environmentModel(
      [process.env.VOICE_TTS_MODEL],
      DEFAULT_TTS_MODEL,
    ),
    highFidelityEnabled: false,
    highFidelityModel: isQwenRealtimeModel(realtimeModel)
      ? realtimeModel
      : DEFAULT_QWEN_REALTIME_MODEL,
  };
}

function environmentNumber(
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function readSetting(key: string): unknown {
  const row = database().prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function boundedDecimal(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function modelSetting(
  key: string,
  fallback: string,
  allowEmpty = false,
): string {
  const value = readSetting(key);
  return isModelAlias(value, allowEmpty) ? value : fallback;
}

export function getProductSettings(): ProductSettings {
  const defaults = defaultSettings();
  const defaultCompanion = readSetting("default_companion");
  const asrProvider = readSetting("asr_provider");
  const ttsProvider = readSetting("tts_provider");
  const highFidelityModel = readSetting("high_fidelity_model");
  return {
    guestTrialSeconds: boundedNumber(
      readSetting("guest_trial_seconds"),
      defaults.guestTrialSeconds,
      30,
      600,
    ),
    wechatDailySeconds: boundedNumber(
      readSetting("wechat_daily_seconds"),
      defaults.wechatDailySeconds,
      60,
      3600,
    ),
    vadSilenceMs: boundedNumber(
      readSetting("vad_silence_ms"),
      defaults.vadSilenceMs,
      500,
      3000,
    ),
    vadThreshold: boundedDecimal(
      readSetting("vad_threshold"),
      defaults.vadThreshold,
      0.1,
      0.95,
    ),
    speechPadMs: boundedNumber(
      readSetting("speech_pad_ms"),
      defaults.speechPadMs,
      0,
      1000,
    ),
    defaultCompanion: isCompanionVoice(defaultCompanion)
      ? defaultCompanion
      : defaults.defaultCompanion,
    economyModel: modelSetting("economy_model", defaults.economyModel),
    economyFallbackModel: modelSetting(
      "economy_fallback_model",
      defaults.economyFallbackModel,
      true,
    ),
    strongModel: modelSetting("strong_model", defaults.strongModel),
    strongFallbackModel: modelSetting(
      "strong_fallback_model",
      defaults.strongFallbackModel,
      true,
    ),
    asrProvider: asrProvider === "sensevoice-local"
      ? asrProvider
      : defaults.asrProvider,
    asrModel: modelSetting("asr_model", defaults.asrModel),
    ttsProvider: ttsProvider === "qwen3-realtime"
      ? ttsProvider
      : defaults.ttsProvider,
    ttsModel: modelSetting("tts_model", defaults.ttsModel),
    highFidelityEnabled:
      readSetting("high_fidelity_enabled") === true,
    highFidelityModel:
      typeof highFidelityModel === "string" &&
      isQwenRealtimeModel(highFidelityModel)
      ? highFidelityModel
      : defaults.highFidelityModel,
  };
}

export function validateProductSettings(input: Partial<ProductSettings>): void {
  if (
    (input.guestTrialSeconds !== undefined &&
      (!Number.isInteger(input.guestTrialSeconds) ||
        input.guestTrialSeconds < 30 ||
        input.guestTrialSeconds > 600)) ||
    (input.wechatDailySeconds !== undefined &&
      (!Number.isInteger(input.wechatDailySeconds) ||
        input.wechatDailySeconds < 60 ||
        input.wechatDailySeconds > 3600)) ||
    (input.vadSilenceMs !== undefined &&
      (!Number.isInteger(input.vadSilenceMs) ||
        input.vadSilenceMs < 500 ||
        input.vadSilenceMs > 3000)) ||
    (input.vadThreshold !== undefined &&
      (!Number.isFinite(input.vadThreshold) ||
        input.vadThreshold < 0.1 ||
        input.vadThreshold > 0.95)) ||
    (input.speechPadMs !== undefined &&
      (!Number.isInteger(input.speechPadMs) ||
        input.speechPadMs < 0 ||
        input.speechPadMs > 1000)) ||
    (input.defaultCompanion !== undefined &&
      !isCompanionVoice(input.defaultCompanion)) ||
    (input.economyModel !== undefined &&
      !isModelAlias(input.economyModel)) ||
    (input.economyFallbackModel !== undefined &&
      !isModelAlias(input.economyFallbackModel, true)) ||
    (input.strongModel !== undefined &&
      !isModelAlias(input.strongModel)) ||
    (input.strongFallbackModel !== undefined &&
      !isModelAlias(input.strongFallbackModel, true)) ||
    (input.asrProvider !== undefined &&
      input.asrProvider !== "sensevoice-local") ||
    (input.asrModel !== undefined &&
      !isModelAlias(input.asrModel)) ||
    (input.ttsProvider !== undefined &&
      input.ttsProvider !== "qwen3-realtime") ||
    (input.ttsModel !== undefined &&
      !isModelAlias(input.ttsModel)) ||
    (input.highFidelityEnabled !== undefined &&
      typeof input.highFidelityEnabled !== "boolean") ||
    (input.highFidelityModel !== undefined &&
      !isQwenRealtimeModel(input.highFidelityModel))
  ) {
    throw new Error("Invalid product settings.");
  }
}

export function updateProductSettings(
  adminId: string,
  input: Partial<ProductSettings>,
): ProductSettings {
  validateProductSettings(input);
  const current = getProductSettings();
  const next: ProductSettings = {
    guestTrialSeconds: boundedNumber(
      input.guestTrialSeconds,
      current.guestTrialSeconds,
      30,
      600,
    ),
    wechatDailySeconds: boundedNumber(
      input.wechatDailySeconds,
      current.wechatDailySeconds,
      60,
      3600,
    ),
    vadSilenceMs: boundedNumber(
      input.vadSilenceMs,
      current.vadSilenceMs,
      500,
      3000,
    ),
    vadThreshold: boundedDecimal(
      input.vadThreshold,
      current.vadThreshold,
      0.1,
      0.95,
    ),
    speechPadMs: boundedNumber(
      input.speechPadMs,
      current.speechPadMs,
      0,
      1000,
    ),
    defaultCompanion: isCompanionVoice(input.defaultCompanion)
      ? input.defaultCompanion
      : current.defaultCompanion,
    economyModel: input.economyModel ?? current.economyModel,
    economyFallbackModel:
      input.economyFallbackModel ?? current.economyFallbackModel,
    strongModel: input.strongModel ?? current.strongModel,
    strongFallbackModel:
      input.strongFallbackModel ?? current.strongFallbackModel,
    asrProvider: input.asrProvider ?? current.asrProvider,
    asrModel: input.asrModel ?? current.asrModel,
    ttsProvider: input.ttsProvider ?? current.ttsProvider,
    ttsModel: input.ttsModel ?? current.ttsModel,
    highFidelityEnabled:
      input.highFidelityEnabled ?? current.highFidelityEnabled,
    highFidelityModel:
      input.highFidelityModel ?? current.highFidelityModel,
  };
  const db = database();
  const write = db.transaction(() => {
    const statement = db.prepare(`
      INSERT INTO app_settings(key, value, updated_by, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `);
    const now = Date.now();
    statement.run("guest_trial_seconds", JSON.stringify(next.guestTrialSeconds), adminId, now);
    statement.run("wechat_daily_seconds", JSON.stringify(next.wechatDailySeconds), adminId, now);
    statement.run("vad_silence_ms", JSON.stringify(next.vadSilenceMs), adminId, now);
    statement.run("vad_threshold", JSON.stringify(next.vadThreshold), adminId, now);
    statement.run("speech_pad_ms", JSON.stringify(next.speechPadMs), adminId, now);
    statement.run("default_companion", JSON.stringify(next.defaultCompanion), adminId, now);
    statement.run("economy_model", JSON.stringify(next.economyModel), adminId, now);
    statement.run("economy_fallback_model", JSON.stringify(next.economyFallbackModel), adminId, now);
    statement.run("strong_model", JSON.stringify(next.strongModel), adminId, now);
    statement.run("strong_fallback_model", JSON.stringify(next.strongFallbackModel), adminId, now);
    statement.run("asr_provider", JSON.stringify(next.asrProvider), adminId, now);
    statement.run("asr_model", JSON.stringify(next.asrModel), adminId, now);
    statement.run("tts_provider", JSON.stringify(next.ttsProvider), adminId, now);
    statement.run("tts_model", JSON.stringify(next.ttsModel), adminId, now);
    statement.run("high_fidelity_enabled", JSON.stringify(next.highFidelityEnabled), adminId, now);
    statement.run("high_fidelity_model", JSON.stringify(next.highFidelityModel), adminId, now);
    db.prepare(`
      INSERT INTO admin_audit_logs(id, admin_id, action, target_id, reason, created_at)
      VALUES(?, ?, 'settings.update', 'product', '调整产品参数', ?)
    `).run(randomUUID(), adminId, now);
  });
  write();
  return next;
}

export function listPromptVersions(): PromptVersion[] {
  getActiveCompanionPrompt();
  const rows = database().prepare(
    "SELECT * FROM prompt_versions ORDER BY created_at DESC",
  ).all() as Array<{
    id: string;
    content: string;
    status: PromptVersion["status"];
    created_by: string | null;
    created_at: number;
    published_at: number | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  }));
}

export function createPromptDraft(adminId: string, content: string): PromptVersion {
  const normalized = content.trim();
  if (normalized.length < 20 || normalized.length > 4000) {
    throw new Error("提示词正文需要 20 到 4000 个字符。");
  }
  const version: PromptVersion = {
    id: randomUUID(),
    content: normalized,
    status: "draft",
    createdBy: adminId,
    createdAt: Date.now(),
    publishedAt: null,
  };
  database().prepare(`
    INSERT INTO prompt_versions(id, content, status, created_by, created_at, published_at)
    VALUES(?, ?, 'draft', ?, ?, NULL)
  `).run(version.id, version.content, adminId, version.createdAt);
  return version;
}

export function publishPromptVersion(
  adminId: string,
  id: string,
): PromptVersion | null {
  const db = database();
  const row = db.prepare("SELECT * FROM prompt_versions WHERE id = ?").get(id) as
    | {
        id: string;
        content: string;
        status: PromptVersion["status"];
        created_by: string | null;
        created_at: number;
        published_at: number | null;
      }
    | undefined;
  if (!row) return null;
  const now = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE prompt_versions SET status = 'archived' WHERE status = 'active'").run();
    db.prepare(
      "UPDATE prompt_versions SET status = 'active', published_at = ? WHERE id = ?",
    ).run(now, id);
    db.prepare(`
      INSERT INTO admin_audit_logs(id, admin_id, action, target_id, reason, created_at)
      VALUES(?, ?, 'prompt.publish', ?, '发布或回滚树洞提示词', ?)
    `).run(randomUUID(), adminId, id, now);
  })();
  return {
    id: row.id,
    content: row.content,
    status: "active",
    createdBy: row.created_by,
    createdAt: row.created_at,
    publishedAt: now,
  };
}
