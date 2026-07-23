import type { RealtimeVoice } from "@/types/realtime";

export const DEFAULT_REALTIME_VOICE: RealtimeVoice = "Theo Calm";
export const GENERATE_REPLY_TOOL_NAME = "generate_reply";
export const VAD_SILENCE_DURATION_MS = 1_500;

export function createQwenSessionUpdate(voice: RealtimeVoice = DEFAULT_REALTIME_VOICE) {
  return {
    event_id: `event_${crypto.randomUUID()}`,
    type: "session.update" as const,
    session: {
      modalities: ["text", "audio"] as const,
      voice,
      input_audio_format: "pcm" as const,
      input_audio_transcription: { model: "qwen3-asr-flash-realtime" },
      output_audio_format: "pcm" as const,
      instructions: [
        `你是实时语音对话的声音层，使用 ${voice} 音色。`,
        "用户每一次有实际内容的发言，无论简单还是复杂，你都必须先调用 generate_reply 工具，把本轮用户的完整问题放入 question 参数；不要自行回答，也不要跳过工具。",
        "工具返回的 output 就是最终答案。收到后直接、完整、自然地朗读，不要改写、概括、补充前后缀，也不要提到工具、模型或系统流程。",
        "用户插话时立即停止当前朗读并重新倾听。",
      ].join("\n"),
      turn_detection: {
        type: "semantic_vad" as const,
        threshold: 0.5,
        silence_duration_ms: VAD_SILENCE_DURATION_MS,
        create_response: true,
        interrupt_response: true,
      },
      tools: [
        {
          type: "function" as const,
          function: {
            name: GENERATE_REPLY_TOOL_NAME,
            description:
              `为用户当前这轮发言生成最终答案。每一轮都必须调用；返回内容将由 ${voice} 原样朗读。`,
            parameters: {
              type: "object" as const,
              properties: {
                question: {
                  type: "string" as const,
                  description: "用户本轮完整问题或表达的意图。",
                },
              },
              required: ["question"],
            },
          },
        },
      ],
      max_tokens: 1200,
      temperature: 0.7,
    },
  };
}
