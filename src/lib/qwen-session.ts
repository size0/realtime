import type { RealtimeVoice } from "@/types/realtime";

export function createQwenSessionUpdate(voice: RealtimeVoice) {
  return {
    event_id: `event_${crypto.randomUUID()}`,
    type: "session.update" as const,
    session: {
      modalities: ["text", "audio"] as const,
      voice,
      input_audio_format: "pcm" as const,
      input_audio_transcription: { model: "qwen3-asr-flash-realtime" },
      output_audio_format: "pcm" as const,
      instructions:
        "你是一个友好、自然、富有共情力且表达简洁的实时语音助手。优先使用用户当前使用的语言回答；用户说中文时使用自然中文。回答要像真实口语交流，语气温暖，有适度停顿感，除非用户要求，不使用冗长列表。用户插话时立即停止当前回答并认真倾听。",
      turn_detection: {
        type: "semantic_vad" as const,
        threshold: 0.5,
        silence_duration_ms: 800,
      },
      max_tokens: 1200,
      temperature: 0.7,
    },
  };
}
