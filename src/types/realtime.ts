export const REALTIME_VOICES = ["Tina", "Ethan", "Theo Calm", "Serena"] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

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

export function isRealtimeVoice(value: string | null): value is RealtimeVoice {
  return REALTIME_VOICES.some((voice) => voice === value);
}
