import { describe, expect, it, vi } from "vitest";
import { createQwenSessionUpdate } from "@/lib/qwen-session";

describe("Qwen session configuration", () => {
  it("configures audio, transcripts and semantic VAD for the selected voice", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "test-id" });
    const update = createQwenSessionUpdate("Tina");
    expect(update).toMatchObject({
      event_id: "event_test-id",
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice: "Tina",
        input_audio_transcription: { model: "qwen3-asr-flash-realtime" },
        turn_detection: {
          type: "semantic_vad",
          threshold: 0.5,
          silence_duration_ms: 800,
        },
      },
    });
    vi.unstubAllGlobals();
  });
});
