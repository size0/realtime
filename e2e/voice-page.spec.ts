import { expect, test } from "@playwright/test";

test("renders the voice console and toggles captions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "对话记录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始对话" })).toBeVisible();
  await expect(page.getByText("准备就绪")).toBeVisible();
  await expect(page.evaluate(() => window.scrollY)).resolves.toBe(0);

  await page.getByRole("button", { name: "隐藏字幕" }).first().click();
  await expect(page.getByText("字幕已隐藏")).toBeVisible();
  await page.getByRole("button", { name: "显示字幕" }).first().click();
  await expect(page.getByText("对话会出现在这里")).toBeVisible();
});

test("restores and clears local transcript history", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "realtime-voice.transcript.v1",
      JSON.stringify({
        version: 1,
        messages: [
          {
            id: "saved-message",
            role: "assistant",
            text: "这是保存在浏览器里的记录。",
            status: "complete",
            createdAt: 1,
          },
        ],
      }),
    );
  });
  await page.goto("/");
  await expect(page.getByText("这是保存在浏览器里的记录。")).toBeVisible();
  await page.getByRole("button", { name: "清空对话记录" }).click();
  await expect(page.getByText("对话会出现在这里")).toBeVisible();
  await expect(
    page.evaluate(() => localStorage.getItem("realtime-voice.transcript.v1")),
  ).resolves.toContain('"messages":[]');
});

test("shows a useful configuration error without calling the live service", async ({ page, context }) => {
  await context.grantPermissions(["microphone"], { origin: "http://127.0.0.1:3100" });
  await page.route("**/api/realtime/connect?**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "MISSING_WORKSPACE_ID",
          message: "服务端尚未配置百炼业务空间 ID。",
        },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始对话" }).click();
  await expect(page.getByText("还缺少百炼业务空间 ID，请在百炼控制台复制后配置。")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "重新连接" })).toBeVisible();
});
