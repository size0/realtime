import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProductSettings: vi.fn(),
  getProviderConfig: vi.fn(),
}));

vi.mock("@/lib/product-admin", () => ({
  getProductSettings: mocks.getProductSettings,
}));
vi.mock("@/lib/provider-config", () => ({
  getProviderConfig: mocks.getProviderConfig,
}));

import { GET } from "@/app/api/internal/voice-config/route";

const SECRET = "voice-worker-secret-with-at-least-32-characters";

function signature(timestamp: number, nonce: string): string {
  return createHmac("sha256", SECRET)
    .update(`${timestamp}.${nonce}.GET./api/internal/voice-config.`)
    .digest("hex");
}

function request(signature: string, timestamp: number, nonce: string): Request {
  return new Request("http://localhost:3000/api/internal/voice-config", {
    headers: {
      "X-Voice-Timestamp": String(timestamp),
      "X-Voice-Nonce": nonce,
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
      vadThreshold: 0.62,
      speechPadMs: 220,
      asrProvider: "sensevoice-local",
      asrModel: "FunAudioLLM/SenseVoiceSmall",
      ttsProvider: "qwen3-realtime",
      ttsModel: "qwen3-tts-instruct-flash-realtime",
    });
    mocks.getProviderConfig.mockReturnValue({
      dashscope: {
        apiKey: "dynamic-dashscope-secret",
        ttsWsUrl: "wss://tts.example/ws",
      },
    });
  });

  it("returns dynamic voice settings to a signed worker", async () => {
    const timestamp = Date.now();
    const nonce = `nonce-${crypto.randomUUID()}`;
    const response = await GET(request(signature(timestamp, nonce), timestamp, nonce));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("qwen3-tts-instruct-flash-realtime");
    expect(body).toContain('"vadThreshold":0.62');
    expect(body).toContain('"speechPadMs":220');
    expect(body).toContain("dynamic-dashscope-secret");
    expect(body).toContain("wss://tts.example/ws");
    expect(body).not.toContain(SECRET);
  });

  it("rejects an invalid worker signature", async () => {
    const response = await GET(request("0".repeat(64), Date.now(), "nonce-invalid"));
    expect(response.status).toBe(401);
    expect(mocks.getProductSettings).not.toHaveBeenCalled();
  });

  it("rejects replayed worker config requests", async () => {
    const timestamp = Date.now();
    const nonce = `nonce-${crypto.randomUUID()}`;
    const signed = signature(timestamp, nonce);
    expect((await GET(request(signed, timestamp, nonce))).status).toBe(200);
    expect((await GET(request(signed, timestamp, nonce))).status).toBe(401);
  });
});
