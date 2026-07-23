export const VOICE_MODES = ["economy", "qwen-realtime"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export const SPLIT_TTS_VOICES = ["Cherry"] as const;
export type SplitTtsVoice = (typeof SPLIT_TTS_VOICES)[number];

export type SplitVoiceServerEvent =
  | { type: "ready"; eventId: string; inputSampleRate: 16000; outputSampleRate: 24000 }
  | { type: "speech_started"; eventId: string }
  | { type: "speech_stopped"; eventId: string; utteranceId: string }
  | { type: "transcript"; eventId: string; utteranceId: string; text: string }
  | { type: "audio_start"; eventId: string; responseId: string; segmentId: string }
  | { type: "audio_done"; eventId: string; responseId: string; segmentId: string }
  | { type: "interrupted"; eventId: string }
  | { type: "error"; eventId: string; code: string; message: string; recoverable: boolean };

export type SplitVoiceClientEvent =
  | { type: "configure"; voice: SplitTtsVoice }
  | { type: "synthesize"; responseId: string; segmentId: string; text: string }
  | { type: "cancel" }
  | { type: "stop" };

