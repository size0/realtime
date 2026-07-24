import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { getActiveCompanionPrompt } from "@/lib/conversation-store";
import {
  isCompanionVoice,
  type CompanionVoice,
} from "@/types/product";

export interface ProductSettings {
  guestTrialSeconds: number;
  wechatDailySeconds: number;
  vadSilenceMs: number;
  defaultCompanion: CompanionVoice;
}

export interface PromptVersion {
  id: string;
  content: string;
  status: "draft" | "active" | "archived";
  createdBy: string | null;
  createdAt: number;
  publishedAt: number | null;
}

const DEFAULT_SETTINGS: ProductSettings = {
  guestTrialSeconds: 180,
  wechatDailySeconds: 600,
  vadSilenceMs: 1100,
  defaultCompanion: "breeze",
};

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

export function getProductSettings(): ProductSettings {
  const defaultCompanion = readSetting("default_companion");
  return {
    guestTrialSeconds: boundedNumber(
      readSetting("guest_trial_seconds"),
      DEFAULT_SETTINGS.guestTrialSeconds,
      30,
      600,
    ),
    wechatDailySeconds: boundedNumber(
      readSetting("wechat_daily_seconds"),
      DEFAULT_SETTINGS.wechatDailySeconds,
      60,
      3600,
    ),
    vadSilenceMs: boundedNumber(
      readSetting("vad_silence_ms"),
      DEFAULT_SETTINGS.vadSilenceMs,
      500,
      3000,
    ),
    defaultCompanion: isCompanionVoice(defaultCompanion)
      ? defaultCompanion
      : DEFAULT_SETTINGS.defaultCompanion,
  };
}

export function updateProductSettings(
  adminId: string,
  input: Partial<ProductSettings>,
): ProductSettings {
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
    (input.defaultCompanion !== undefined &&
      !isCompanionVoice(input.defaultCompanion))
  ) {
    throw new Error("Invalid product settings.");
  }
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
    defaultCompanion: isCompanionVoice(input.defaultCompanion)
      ? input.defaultCompanion
      : current.defaultCompanion,
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
    statement.run("default_companion", JSON.stringify(next.defaultCompanion), adminId, now);
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
