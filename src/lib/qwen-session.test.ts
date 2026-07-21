import { describe, expect, it, vi } from "vitest";
import {
  createQwenSessionUpdate,
  DEFAULT_REALTIME_VOICE,
  GENERATE_REPLY_TOOL_NAME,
  VAD_SILENCE_DURATION_MS,
} from "@/lib/qwen-session";

describe("Qwen session configuration", () => {
  it("defaults to Tina, accepts a selected voice and routes every reply through the tool", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "test-id" });
    const update = createQwenSessionUpdate("Ethan");
    expect(update).toMatchObject({
      event_id: "event_test-id",
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice: "Ethan",
        input_audio_transcription: { model: "qwen3-asr-flash-realtime" },
        turn_detection: {
          type: "semantic_vad",
          threshold: 0.5,
          silence_duration_ms: VAD_SILENCE_DURATION_MS,
          create_response: true,
          interrupt_response: true,
        },
        tools: [
          {
            type: "function",
            function: {
              name: GENERATE_REPLY_TOOL_NAME,
              parameters: { required: ["question"] },
            },
          },
        ],
      },
    });
    expect(update.session.instructions).toContain("必须先调用 generate_reply");
    expect(update.session.instructions).toContain("Ethan");
    expect(createQwenSessionUpdate().session.voice).toBe(DEFAULT_REALTIME_VOICE);
    expect(VAD_SILENCE_DURATION_MS).toBe(1_500);
    vi.unstubAllGlobals();
  });
});
