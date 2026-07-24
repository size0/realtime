import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGuestUser, resetAuthStoreForTests } from "@/lib/auth-store";
import {
  addConversationMessages,
  adminReadConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listAdminAuditLogs,
  listConversations,
  purgeExpiredMessages,
} from "@/lib/conversation-store";
import { resetDatabaseForTests } from "@/lib/database";

describe("encrypted conversation store", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "voice-conversation-"));
    process.env.APP_DATABASE_FILE = path.join(directory, "app.sqlite");
    process.env.APP_DATA_FILE = path.join(directory, "missing-users.json");
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
    process.env.MESSAGE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    resetDatabaseForTests();
    resetAuthStoreForTests();
  });

  afterEach(async () => {
    resetAuthStoreForTests();
    resetDatabaseForTests();
    delete process.env.APP_DATABASE_FILE;
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    delete process.env.MESSAGE_ENCRYPTION_KEY;
    await rm(directory, { recursive: true, force: true });
  });

  it("stores only ciphertext and merges duplicate message ids idempotently", async () => {
    const user = await createGuestUser();
    const conversation = createConversation(user.id, "breeze");
    const secretText = "这是只应在解密后出现的树洞内容";

    addConversationMessages(user.id, conversation.id, [{
      id: "message-1",
      role: "user",
      text: secretText,
      status: "complete",
      createdAt: Date.now(),
    }]);
    addConversationMessages(user.id, conversation.id, [{
      id: "message-1",
      role: "user",
      text: secretText,
      status: "complete",
      createdAt: Date.now(),
    }]);

    const loaded = getConversation(user.id, conversation.id);
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.messages[0]?.text).toBe(secretText);
    const bytes = await readFile(process.env.APP_DATABASE_FILE!);
    expect(bytes.toString("utf8")).not.toContain(secretText);
  });

  it("authorizes ownership, audits admin reads, deletes and purges old text", async () => {
    const owner = await createGuestUser();
    const other = await createGuestUser();
    const conversation = createConversation(owner.id, "nightwatch");
    const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
    addConversationMessages(owner.id, conversation.id, [{
      id: "old-message",
      role: "assistant",
      text: "旧消息",
      status: "complete",
      createdAt: oldTimestamp,
    }]);

    expect(getConversation(other.id, conversation.id)).toBeNull();
    expect(() => adminReadConversation("admin-1", conversation.id, "  ")).toThrow();
    expect(adminReadConversation("admin-1", conversation.id, "用户反馈核查")?.messages)
      .toHaveLength(1);
    expect(listAdminAuditLogs()).toEqual([
      expect.objectContaining({
        adminId: "admin-1",
        action: "conversation.read",
        reason: "用户反馈核查",
      }),
    ]);

    expect(purgeExpiredMessages(Date.now())).toBe(1);
    expect(getConversation(owner.id, conversation.id)?.messages).toHaveLength(0);
    expect(listConversations(owner.id)).toHaveLength(1);
    expect(deleteConversation(owner.id, conversation.id)).toBe(true);
    expect(listConversations(owner.id)).toHaveLength(0);
  });
});
