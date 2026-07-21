export const REALTIME_VOICES = [
  "Tina",
  "Liora Mira",
  "Serena",
  "Cindy",
  "Sunnybobi",
  "Ethan",
  "Raymond",
  "Theo Calm",
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

export const REALTIME_VOICE_OPTIONS: ReadonlyArray<{
  value: RealtimeVoice;
  label: string;
  description: string;
}> = [
  { value: "Tina", label: "甜甜 Tina", description: "甜美温暖" },
  { value: "Liora Mira", label: "清欢 Liora Mira", description: "自然温柔" },
  { value: "Serena", label: "苏瑶 Serena", description: "柔和亲切" },
  { value: "Cindy", label: "林欣宜 Cindy", description: "台湾口音" },
  { value: "Sunnybobi", label: "知芝 Sunnybobi", description: "邻家活泼" },
  { value: "Ethan", label: "晨煦 Ethan", description: "阳光男声" },
  { value: "Raymond", label: "林川野 Raymond", description: "清亮男声" },
  { value: "Theo Calm", label: "Theo Calm", description: "沉稳治愈" },
];

export function isRealtimeVoice(value: string): value is RealtimeVoice {
  return (REALTIME_VOICES as readonly string[]).includes(value);
}

export type CallStatus =
  | "idle"
  | "requesting-permission"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "disconnected"
  | "error";

export type TranscriptRole = "user" | "assistant";
export type TranscriptStatus = "streaming" | "complete" | "interrupted" | "failed";

export interface TranscriptMessage {
  id: string;
  role: TranscriptRole;
  text: string;
  status: TranscriptStatus;
  createdAt: number;
}

export interface RealtimeState {
  callStatus: CallStatus;
  messages: TranscriptMessage[];
  errorMessage: string | null;
}

type RealtimeServerEventCore =
  | { type: "session.created" | "session.updated" }
  | { type: "input_audio_buffer.speech_started" }
  | { type: "input_audio_buffer.speech_stopped" }
  | { type: "response.created" }
  | { type: "response.audio.delta" }
  | { type: "response.audio.done" | "response.done" }
  | {
      type: "response.function_call_arguments.delta";
      item_id: string;
      call_id: string;
      delta: string;
    }
  | {
      type: "response.function_call_arguments.done";
      item_id: string;
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "conversation.item.input_audio_transcription.delta";
      item_id: string;
      delta: string;
    }
  | {
      type: "conversation.item.input_audio_transcription.completed";
      item_id: string;
      transcript: string;
    }
  | {
      type: "conversation.item.input_audio_transcription.failed";
      item_id: string;
    }
  | {
      type: "response.audio_transcript.delta" | "response.text.delta";
      item_id: string;
      delta: string;
    }
  | {
      type: "response.audio_transcript.done" | "response.text.done";
      item_id: string;
      transcript: string;
    }
  | { type: "conversation.item.truncated"; item_id: string }
  | { type: "error"; error: { message?: string; code?: string } }
  | { type: "unknown"; originalType: string };

export type RealtimeServerEvent = RealtimeServerEventCore & { eventId?: string };
