import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/auth/wechat/callback/route";

describe("GET /api/auth/wechat/callback", () => {
  afterEach(() => {
    delete process.env.APP_ORIGIN;
  });

  it("redirects failures to the configured public app origin", async () => {
    process.env.APP_ORIGIN = "https://voice.example.com";

    const response = await GET(
      new Request("https://localhost:3502/api/auth/wechat/callback?code=x&state=y"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://voice.example.com/?wechatError=state",
    );
  });
});
