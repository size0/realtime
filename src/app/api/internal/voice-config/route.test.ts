import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProductSettings: vi.fn(),
}));

vi.mock("@/lib/product-admin", () => ({
  getProductSettings: mocks.getProductSettings,
}));

import { GET } from "@/app/api/internal/voice-config/route";

const SECRET = "voice-worker-secret-with-at-least-32-characters";

function request(signature: string, timestamp: number): Request {
  return new Request("http://localhost:3000/api/internal/voice-config", {
    headers: {
      "X-Voice-Timestamp": String(timestamp),
      "X-Voice-Signature": signature,
    },
  });
}

describe("GET /api/internal/voice-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOICE_WORKER_SECRET = SECRET;
    mocks.getProductSettings.mockReturnValue({
      vadSilenceMs: 1250,
      asrProvider: "sensevoice-local",
      asrModel: "FunAudioLLM/SenseVoiceSmall",
      ttsProvider: "qwen3-realtime",
      ttsModel: "qwen3-tts-instruct-flash-realtime",
    });
  });

  it("returns only non-secret voice settings to a signed worker", async () => {
    const timestamp = Date.now();
    const signature = createHmac("sha256", SECRET)
      .update(`${timestamp}.`)
      .digest("hex");
    const response = await GET(request(signature, timestamp));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("qwen3-tts-instruct-flash-realtime");
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("apiKey");
  });

  it("rejects an invalid worker signature", async () => {
    const response = await GET(request("0".repeat(64), Date.now()));
    expect(response.status).toBe(401);
    expect(mocks.getProductSettings).not.toHaveBeenCalled();
  });
});
