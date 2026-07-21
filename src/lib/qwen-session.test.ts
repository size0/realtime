import { describe, expect, it, vi } from "vitest";
import {
  createQwenSessionUpdate,
  GENERATE_REPLY_TOOL_NAME,
  REALTIME_VOICE,
  VAD_SILENCE_DURATION_MS,
} from "@/lib/qwen-session";

describe("Qwen session configuration", () => {
  it("fixes Tina voice, delays turn completion and routes every reply through the tool", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "test-id" });
    const update = createQwenSessionUpdate();
    expect(update).toMatchObject({
      event_id: "event_test-id",
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice: REALTIME_VOICE,
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
    expect(VAD_SILENCE_DURATION_MS).toBe(1_500);
    vi.unstubAllGlobals();
  });
});
