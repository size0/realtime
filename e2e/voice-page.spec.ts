import { expect, test, type Page } from "@playwright/test";

async function loginAdmin(page: Page) {
  await page.goto("/login?admin=1");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("Admin-password-123");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("creates a guest and shows only the three companion roles", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今晚，想说点什么？" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始聊聊" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /晚风/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /微光/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /守夜/ })).toBeVisible();
  await expect(page.getByText(/省钱模式|高保真模式|Qwen|Cherry|Serena|Ethan/)).toHaveCount(0);
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "隐藏字幕" }).click();
  await expect(page.getByText("字幕已经藏起来了")).toBeVisible();
  await page.getByRole("button", { name: "显示字幕" }).click();
  await expect(page.getByText("说出口的话，会轻轻落在这里")).toBeVisible();
});

test("restores and clears local transcript history", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "realtime-voice.transcript.v1",
      JSON.stringify({
        version: 1,
        messages: [{
          id: "saved-message",
          role: "assistant",
          text: "这是保存在浏览器里的记录。",
          status: "complete",
          createdAt: 1,
        }],
      }),
    );
  });
  await page.goto("/");
  await expect(page.getByText("这是保存在浏览器里的记录。")).toBeVisible();
  await page.getByRole("button", { name: "清空所有对话记录" }).click();
  await expect(page.getByText("说出口的话，会轻轻落在这里")).toBeVisible();
  await expect(
    page.evaluate(() => localStorage.getItem("realtime-voice.transcript.v1")),
  ).resolves.toContain('"messages":[]');
});

test("shows a friendly voice configuration error", async ({ page, context }) => {
  await context.grantPermissions(["microphone"], {
    origin: "http://127.0.0.1:3100",
  });
  await page.route("**/api/voice/token", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "VOICE_WORKER_NOT_CONFIGURED",
          message: "provider details must stay hidden",
        },
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "开始聊聊" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "开始聊聊" }).click();
  await expect(page.getByText("语音服务正在准备中，请稍后再试。")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "重新试试" })).toBeVisible();
  await expect(page.getByText("provider details must stay hidden")).toHaveCount(0);
});

test("keeps the admin login hidden and opens the five backend modules", async ({ page }) => {
  await loginAdmin(page);
  await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  for (const tab of ["用户", "对话", "产品设置", "提示词与审计"]) {
    await page.getByRole("button", { name: tab }).click();
    await expect(page.getByRole("heading", { name: tab, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "产品设置" }).click();
  await expect(page.getByLabel("访客体验（秒）")).toHaveValue("180");
  await expect(page.getByLabel("微信每日额度（秒）")).toHaveValue("600");
  await expect(page.getByText(/API Key、AppSecret/)).toBeVisible();
});
