import { describe, expect, it } from "vitest";
import {
  createQwenRealtimeUrl,
  isQwenRealtimeModel,
  isValidWorkspaceId,
} from "@/lib/realtime-session";

describe("Qwen Realtime endpoint configuration", () => {
  it("builds the Beijing WebRTC URL with the selected model", () => {
    expect(createQwenRealtimeUrl("llm-test", "qwen3.5-omni-flash-realtime")).toBe(
      "https://llm-test.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.5-omni-flash-realtime",
    );
  });

  it("builds the Singapore endpoint when explicitly configured", () => {
    expect(
      createQwenRealtimeUrl(
        "llm-test",
        "qwen3.5-omni-plus-realtime",
        "ap-southeast-1",
      ),
    ).toContain("llm-test.ap-southeast-1.maas.aliyuncs.com");
  });

  it("rejects unsafe workspace ids and unknown models", () => {
    expect(isValidWorkspaceId("llm-valid-123")).toBe(true);
    expect(isValidWorkspaceId("https://attacker.example")).toBe(false);
    expect(isQwenRealtimeModel("qwen3.5-omni-plus-realtime")).toBe(true);
    expect(isQwenRealtimeModel("unknown")).toBe(false);
    expect(() => createQwenRealtimeUrl("../invalid")).toThrow();
  });
});
