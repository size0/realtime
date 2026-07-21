import type {
  RealtimeServerEvent,
  RealtimeState,
  TranscriptMessage,
  TranscriptRole,
  TranscriptStatus,
} from "@/types/realtime";

export const MAX_TRANSCRIPT_MESSAGES = 200;

type TranscriptUpdate = {
  id: string;
  role: TranscriptRole;
  text?: string;
  mode?: "append" | "replace";
  status?: TranscriptStatus;
  createdAt?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function parseRealtimeEvent(value: unknown): RealtimeServerEvent | null {
  if (!isRecord(value)) return null;
  const type = readString(value, "type");
  if (!type) return null;
  const eventId = readString(value, "event_id") ?? undefined;

  switch (type) {
    case "session.created":
    case "session.updated":
    case "input_audio_buffer.speech_started":
    case "input_audio_buffer.speech_stopped":
    case "response.created":
    case "response.audio.delta":
    case "response.audio.done":
    case "response.done":
      return { type, eventId };
    case "conversation.item.input_audio_transcription.delta": {
      const itemId = readString(value, "item_id");
      const text = readString(value, "text");
      const stash = readString(value, "stash");
      const legacyDelta = readString(value, "delta");
      const preview = text !== null || stash !== null ? `${text ?? ""}${stash ?? ""}` : legacyDelta;
      return itemId && preview !== null
        ? { type, item_id: itemId, delta: preview, eventId }
        : null;
    }
    case "response.audio_transcript.delta":
    case "response.text.delta": {
      const itemId = readString(value, "item_id");
      const delta = readString(value, "delta");
      return itemId && delta !== null ? { type, item_id: itemId, delta, eventId } : null;
    }
    case "conversation.item.input_audio_transcription.completed": {
      const itemId = readString(value, "item_id");
      const transcript = readString(value, "transcript");
      return itemId && transcript !== null
        ? { type, item_id: itemId, transcript, eventId }
        : null;
    }
    case "response.audio_transcript.done":
    case "response.text.done": {
      const itemId = readString(value, "item_id");
      const transcript =
        type === "response.text.done"
          ? readString(value, "text")
          : readString(value, "transcript");
      return itemId && transcript !== null
        ? { type, item_id: itemId, transcript, eventId }
        : null;
    }
    case "conversation.item.input_audio_transcription.failed":
    case "conversation.item.truncated": {
      const itemId = readString(value, "item_id");
      return itemId ? { type, item_id: itemId, eventId } : null;
    }
    case "error": {
      const errorValue = value.error;
      const error = isRecord(errorValue)
        ? {
            message: readString(errorValue, "message") ?? undefined,
            code: readString(errorValue, "code") ?? undefined,
          }
        : {};
      return { type, error, eventId };
    }
    default:
      return { type: "unknown", originalType: type, eventId };
  }
}

export function isDuplicateRealtimeEvent(
  event: RealtimeServerEvent,
  seenEventIds: Set<string>,
  maxRemembered = 256,
): boolean {
  if (!event.eventId) return false;
  if (seenEventIds.has(event.eventId)) return true;
  seenEventIds.add(event.eventId);
  if (seenEventIds.size > maxRemembered) {
    const oldest = seenEventIds.values().next().value;
    if (typeof oldest === "string") seenEventIds.delete(oldest);
  }
  return false;
}

export function mergeTranscript(
  messages: TranscriptMessage[],
  update: TranscriptUpdate,
): TranscriptMessage[] {
  const existingIndex = messages.findIndex((message) => message.id === update.id);

  if (existingIndex === -1) {
    const text = update.text ?? "";
    if (!text && update.status !== "failed") return messages;
    return [
      ...messages,
      {
        id: update.id,
        role: update.role,
        text,
        status: update.status ?? "streaming",
        createdAt: update.createdAt ?? Date.now(),
      },
    ].slice(-MAX_TRANSCRIPT_MESSAGES);
  }

  const nextMessages = [...messages];
  const existing = nextMessages[existingIndex];
  const nextText =
    update.text === undefined
      ? existing.text
      : update.mode === "replace"
        ? update.text
        : `${existing.text}${update.text}`;

  nextMessages[existingIndex] = {
    ...existing,
    text: nextText,
    status: update.status ?? existing.status,
  };

  return nextMessages.slice(-MAX_TRANSCRIPT_MESSAGES);
}

function interruptLatestAssistant(messages: TranscriptMessage[]): TranscriptMessage[] {
  let index = -1;
  for (let current = messages.length - 1; current >= 0; current -= 1) {
    const message = messages[current];
    if (message.role === "assistant" && message.status === "streaming") {
      index = current;
      break;
    }
  }
  if (index === -1) return messages;
  const next = [...messages];
  next[index] = { ...next[index], status: "interrupted" };
  return next;
}

export const initialRealtimeState: RealtimeState = {
  callStatus: "idle",
  messages: [],
  errorMessage: null,
};

export type RealtimeAction =
  | { type: "set-status"; status: RealtimeState["callStatus"] }
  | { type: "set-error"; message: string }
  | { type: "load-messages"; messages: TranscriptMessage[] }
  | { type: "clear-messages" }
  | { type: "server-event"; event: RealtimeServerEvent };

export function realtimeReducer(state: RealtimeState, action: RealtimeAction): RealtimeState {
  switch (action.type) {
    case "set-status":
      return { ...state, callStatus: action.status, errorMessage: null };
    case "set-error":
      return { ...state, callStatus: "error", errorMessage: action.message };
    case "load-messages":
      return { ...state, messages: action.messages.slice(-MAX_TRANSCRIPT_MESSAGES) };
    case "clear-messages":
      return { ...state, messages: [] };
    case "server-event":
      break;
  }

  const event = action.event;
  switch (event.type) {
    case "session.created":
      return { ...state, errorMessage: null };
    case "session.updated":
      return { ...state, callStatus: "listening", errorMessage: null };
    case "input_audio_buffer.speech_started":
      return {
        ...state,
        callStatus: "listening",
        messages:
          state.callStatus === "speaking"
            ? interruptLatestAssistant(state.messages)
            : state.messages,
      };
    case "input_audio_buffer.speech_stopped":
    case "response.created":
      return { ...state, callStatus: "thinking" };
    case "response.audio.delta":
      return { ...state, callStatus: "speaking" };
    case "response.audio.done":
    case "response.done":
      return { ...state, callStatus: "listening" };
    case "conversation.item.input_audio_transcription.delta":
      return {
        ...state,
        messages: mergeTranscript(state.messages, {
          id: event.item_id,
          role: "user",
          text: event.delta,
          mode: "replace",
          status: "streaming",
        }),
      };
    case "conversation.item.input_audio_transcription.completed":
      return {
        ...state,
        messages: mergeTranscript(state.messages, {
          id: event.item_id,
          role: "user",
          text: event.transcript,
          mode: "replace",
          status: "complete",
        }),
      };
    case "conversation.item.input_audio_transcription.failed":
      return {
        ...state,
        messages: mergeTranscript(state.messages, {
          id: event.item_id,
          role: "user",
          text: "语音转写失败",
          mode: "replace",
          status: "failed",
        }),
      };
    case "response.audio_transcript.delta":
    case "response.text.delta":
      return {
        ...state,
        callStatus: "speaking",
        messages: mergeTranscript(state.messages, {
          id: event.item_id,
          role: "assistant",
          text: event.delta,
          mode: "append",
          status: "streaming",
        }),
      };
    case "response.audio_transcript.done":
    case "response.text.done":
      return {
        ...state,
        messages: mergeTranscript(state.messages, {
          id: event.item_id,
          role: "assistant",
          text: event.transcript,
          mode: "replace",
          status: "complete",
        }),
      };
    case "conversation.item.truncated":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === event.item_id ? { ...message, status: "interrupted" } : message,
        ),
      };
    case "error":
      return {
        ...state,
        callStatus: "error",
        errorMessage: event.error.message ?? "千问实时会话发生错误，请重试。",
      };
    case "unknown":
      return state;
  }
}
