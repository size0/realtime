import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import type { TranscriptMessage, TranscriptRole, TranscriptStatus } from "@/types/realtime";
import {
  isCompanionVoice,
  type CompanionVoice,
  type ConversationRisk,
  type ConversationStatus,
} from "@/types/product";

export interface ConversationSummary {
  id: string;
  userId: string;
  companionVoice: CompanionVoice;
  status: ConversationStatus;
  riskLevel: ConversationRisk;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ConversationDetail extends ConversationSummary {
  messages: TranscriptMessage[];
}

interface ConversationRow {
  id: string;
  user_id: string;
  companion_voice: CompanionVoice;
  status: ConversationStatus;
  risk_level: ConversationRisk;
  created_at: number;
  updated_at: number;
  message_count?: number;
}

interface MessageRow {
  id: string;
  role: TranscriptRole;
  status: TranscriptStatus;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at: number;
}

interface AuditRow {
  id: string;
  admin_id: string;
  action: string;
  target_id: string | null;
  reason: string;
  created_at: number;
}

function encryptionKey(): Buffer {
  const configured = process.env.MESSAGE_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("MESSAGE_ENCRYPTION_KEY is not configured.");
  const decoded = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (decoded.length !== 32) {
    throw new Error("MESSAGE_ENCRYPTION_KEY must decode to 32 bytes.");
  }
  return decoded;
}

function encryptText(text: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptText(row: Pick<MessageRow, "ciphertext" | "iv" | "auth_tag">): string {
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

function ensureDefaultPrompt(): string {
  const db = database();
  const active = db.prepare(
    "SELECT id FROM prompt_versions WHERE status = 'active' ORDER BY published_at DESC LIMIT 1",
  ).get() as { id: string } | undefined;
  if (active) return active.id;
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO prompt_versions(id, content, status, created_by, created_at, published_at)
    VALUES(?, ?, 'active', NULL, ?, ?)
  `).run(
    id,
    "先接住对方当下的感受，再给恰到好处的回应。语言自然、克制、真诚，避免客服腔、说教和模板鸡汤。",
    now,
    now,
  );
  return id;
}

function summary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    userId: row.user_id,
    companionVoice: row.companion_voice,
    status: row.status,
    riskLevel: row.risk_level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count ?? 0,
  };
}

export function createConversation(
  userId: string,
  companionVoice: CompanionVoice,
): ConversationSummary {
  if (!isCompanionVoice(companionVoice)) throw new Error("Invalid companion voice.");
  const id = randomUUID();
  const now = Date.now();
  database().prepare(`
    INSERT INTO conversations(
      id, user_id, companion_voice, status, risk_level, prompt_version_id,
      created_at, updated_at
    ) VALUES(?, ?, ?, 'active', 'normal', ?, ?, ?)
  `).run(id, userId, companionVoice, ensureDefaultPrompt(), now, now);
  return {
    id,
    userId,
    companionVoice,
    status: "active",
    riskLevel: "normal",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}

function validateMessage(message: TranscriptMessage): void {
  if (
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(message.id) ||
    (message.role !== "user" && message.role !== "assistant") ||
    !["streaming", "complete", "interrupted", "failed"].includes(message.status) ||
    !message.text.trim() ||
    message.text.length > 8_000 ||
    !Number.isSafeInteger(message.createdAt)
  ) {
    throw new Error("Invalid conversation message.");
  }
}

export function addConversationMessages(
  userId: string,
  conversationId: string,
  messages: TranscriptMessage[],
): number {
  if (messages.length < 1 || messages.length > 20) {
    throw new Error("Message batch must contain 1 to 20 messages.");
  }
  const db = database();
  const conversation = db.prepare(
    "SELECT id FROM conversations WHERE id = ? AND user_id = ?",
  ).get(conversationId, userId);
  if (!conversation) throw new Error("Conversation not found.");
  const insert = db.prepare(`
    INSERT OR IGNORE INTO messages(
      id, conversation_id, role, status, ciphertext, iv, auth_tag, key_version, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const write = db.transaction((entries: TranscriptMessage[]) => {
    let count = 0;
    for (const message of entries) {
      validateMessage(message);
      const encrypted = encryptText(message.text.trim());
      const result = insert.run(
        message.id,
        conversationId,
        message.role,
        message.status,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        message.createdAt,
      );
      count += result.changes;
    }
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(Date.now(), conversationId);
    return count;
  });
  return write(messages);
}

function loadDetail(row: ConversationRow): ConversationDetail {
  const messages = database().prepare(`
    SELECT id, role, status, ciphertext, iv, auth_tag, created_at
    FROM messages WHERE conversation_id = ? ORDER BY created_at, id
  `).all(row.id) as MessageRow[];
  return {
    ...summary({ ...row, message_count: messages.length }),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      status: message.status,
      text: decryptText(message),
      createdAt: message.created_at,
    })),
  };
}

export function getConversation(userId: string, id: string): ConversationDetail | null {
  const row = database().prepare(
    "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
  ).get(id, userId) as ConversationRow | undefined;
  return row ? loadDetail(row) : null;
}

export function listConversations(userId: string, limit = 30): ConversationSummary[] {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const rows = database().prepare(`
    SELECT conversations.*, COUNT(messages.id) AS message_count
    FROM conversations LEFT JOIN messages ON messages.conversation_id = conversations.id
    WHERE conversations.user_id = ?
    GROUP BY conversations.id
    ORDER BY conversations.created_at DESC LIMIT ?
  `).all(userId, safeLimit) as ConversationRow[];
  return rows.map(summary);
}

export function listAdminConversations(limit = 100): ConversationSummary[] {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const rows = database().prepare(`
    SELECT conversations.*, COUNT(messages.id) AS message_count
    FROM conversations LEFT JOIN messages ON messages.conversation_id = conversations.id
    GROUP BY conversations.id
    ORDER BY conversations.created_at DESC LIMIT ?
  `).all(safeLimit) as ConversationRow[];
  return rows.map(summary);
}

export function updateConversation(
  userId: string,
  id: string,
  update: { status?: ConversationStatus; riskLevel?: ConversationRisk },
): boolean {
  const current = database().prepare(
    "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
  ).get(id, userId) as ConversationRow | undefined;
  if (!current) return false;
  const status = update.status ?? current.status;
  const risk = update.riskLevel ?? current.risk_level;
  if (
    !["active", "completed", "interrupted", "failed"].includes(status) ||
    !["normal", "elevated", "crisis"].includes(risk)
  ) return false;
  database().prepare(
    "UPDATE conversations SET status = ?, risk_level = ?, updated_at = ? WHERE id = ?",
  ).run(status, risk, Date.now(), id);
  return true;
}

export function deleteConversation(userId: string, id: string): boolean {
  return database().prepare(
    "DELETE FROM conversations WHERE id = ? AND user_id = ?",
  ).run(id, userId).changes > 0;
}

export function deleteAllConversations(userId: string): number {
  return database().prepare("DELETE FROM conversations WHERE user_id = ?").run(userId).changes;
}

export function purgeExpiredMessages(now = Date.now()): number {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  return database().prepare("DELETE FROM messages WHERE created_at < ?").run(cutoff).changes;
}

export function adminReadConversation(
  adminId: string,
  conversationId: string,
  reason: string,
): ConversationDetail | null {
  const normalized = reason.trim();
  if (normalized.length < 2 || normalized.length > 120) {
    throw new Error("查看原因需为 2 到 120 个字符。");
  }
  const row = database().prepare(
    "SELECT * FROM conversations WHERE id = ?",
  ).get(conversationId) as ConversationRow | undefined;
  if (!row) return null;
  database().prepare(`
    INSERT INTO admin_audit_logs(id, admin_id, action, target_id, reason, created_at)
    VALUES(?, ?, 'conversation.read', ?, ?, ?)
  `).run(randomUUID(), adminId, conversationId, normalized, Date.now());
  return loadDetail(row);
}

export function listAdminAuditLogs(limit = 100): Array<{
  id: string;
  adminId: string;
  action: string;
  targetId: string | null;
  reason: string;
  createdAt: number;
}> {
  const rows = database().prepare(
    "SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT ?",
  ).all(Math.max(1, Math.min(200, limit))) as AuditRow[];
  return rows.map((row) => ({
    id: row.id,
    adminId: row.admin_id,
    action: row.action,
    targetId: row.target_id,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export function getActiveCompanionPrompt(): string {
  ensureDefaultPrompt();
  const row = database().prepare(
    "SELECT content FROM prompt_versions WHERE status = 'active' ORDER BY published_at DESC LIMIT 1",
  ).get() as { content: string };
  return row.content;
}
