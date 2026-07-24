import { describe, expect, it } from "vitest";
import { mapApiError, mapBrowserError } from "@/lib/client-errors";

describe("client error mapping", () => {
  it("maps stable API error codes to actionable Chinese messages", () => {
    expect(mapApiError("MISSING_API_KEY")).toContain("模型密钥");
    expect(mapApiError("MISSING_API_KEY")).not.toContain("sk-");
    expect(mapApiError("RATE_LIMITED")).toContain("频繁");
  });

  it("maps browser microphone errors", () => {
    expect(mapBrowserError(new DOMException("denied", "NotAllowedError"))).toContain("权限");
    expect(mapBrowserError(new DOMException("missing", "NotFoundError"))).toContain("麦克风");
  });
});
