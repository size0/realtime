import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("Admin-password-123");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page).toHaveURL("/");
}

test("automatically creates a guest and renders all supported voices", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "对话记录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始对话" })).toBeVisible();
  await expect(page.getByText(/访客 [A-F0-9]{6}/)).toBeVisible();
  const voiceSelect = page.getByRole("combobox", { name: "选择音色" });
  await expect(voiceSelect).toHaveValue("Theo Calm");
  await expect(voiceSelect.locator("option")).toHaveCount(10);
  await voiceSelect.selectOption("Ethan");
  await expect(voiceSelect).toHaveValue("Ethan");
  await expect(page.getByText("准备就绪")).toBeVisible();

  await page.getByRole("button", { name: "隐藏字幕" }).first().click();
  await expect(page.getByText("字幕已隐藏")).toBeVisible();
  await page.getByRole("button", { name: "显示字幕" }).first().click();
  await expect(page.getByText("对话会出现在这里")).toBeVisible();
});

test("restores and clears local transcript history for an automatic guest", async ({ page }) => {
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
  await page.route("**/api/realtime/connect?*", async (route) => {
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

test("admin can open the backend and create an account", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "打开管理后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "用户与用量" })).toBeVisible();

  await page.getByLabel("用户名").fill("playwright-user");
  await page.getByLabel("显示名称").fill("自动化用户");
  await page.getByLabel("初始密码").fill("Playwright-password-123");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByText("@playwright-user · 普通用户")).toBeVisible();
});
