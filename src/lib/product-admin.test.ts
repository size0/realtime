import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGuestUser,
  resetAuthStoreForTests,
  voiceSecondsAllowance,
} from "@/lib/auth-store";
import { resetDatabaseForTests } from "@/lib/database";
import {
  createPromptDraft,
  getProductSettings,
  listPromptVersions,
  publishPromptVersion,
  updateProductSettings,
} from "@/lib/product-admin";

describe("product settings and prompt versions", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "voice-product-"));
    process.env.APP_DATABASE_FILE = path.join(directory, "app.sqlite");
    process.env.APP_DATA_FILE = path.join(directory, "users.json");
    process.env.ADMIN_PASSWORD = "Admin-password-123";
    process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
    resetAuthStoreForTests();
  });

  afterEach(async () => {
    resetAuthStoreForTests();
    resetDatabaseForTests();
    delete process.env.APP_DATABASE_FILE;
    delete process.env.APP_DATA_FILE;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    await rm(directory, { recursive: true, force: true });
  });

  it("persists quota settings and applies them to new allowances", async () => {
    expect(getProductSettings()).toMatchObject({
      guestTrialSeconds: 180,
      wechatDailySeconds: 600,
    });
    const updated = updateProductSettings("admin-1", {
      guestTrialSeconds: 240,
      wechatDailySeconds: 900,
      vadSilenceMs: 1300,
      defaultCompanion: "nightwatch",
    });
    expect(updated).toMatchObject({
      guestTrialSeconds: 240,
      wechatDailySeconds: 900,
      vadSilenceMs: 1300,
      defaultCompanion: "nightwatch",
    });
    const guest = await createGuestUser();
    expect(await voiceSecondsAllowance(guest.id)).toMatchObject({
      limitSeconds: 240,
      remainingSeconds: 240,
    });
  });

  it("creates, publishes and rolls back prompt versions", () => {
    const initial = listPromptVersions().find((version) => version.status === "active");
    expect(initial).toBeDefined();
    const draft = createPromptDraft(
      "admin-1",
      "先认真听完，再用自然、克制、真诚的两到四个短句回应对方。",
    );
    expect(draft.status).toBe("draft");
    expect(publishPromptVersion("admin-1", draft.id)).toMatchObject({
      id: draft.id,
      status: "active",
    });
    expect(publishPromptVersion("admin-1", initial!.id)).toMatchObject({
      id: initial!.id,
      status: "active",
    });
  });
});
