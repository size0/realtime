import { MAX_TRANSCRIPT_MESSAGES } from "@/lib/realtime-events";
import type { TranscriptMessage } from "@/types/realtime";

export const TRANSCRIPT_STORAGE_KEY = "realtime-voice.transcript.v1";

interface StoredTranscript {
  version: 1;
  messages: TranscriptMessage[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isTranscriptMessage(value: unknown): value is TranscriptMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.text === "string" &&
    (message.status === "streaming" ||
      message.status === "complete" ||
      message.status === "interrupted" ||
      message.status === "failed") &&
    typeof message.createdAt === "number"
  );
}

export function loadTranscript(storage: StorageLike): TranscriptMessage[] {
  try {
    const raw = storage.getItem(TRANSCRIPT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1 || !Array.isArray(candidate.messages)) return [];
    return candidate.messages.filter(isTranscriptMessage).slice(-MAX_TRANSCRIPT_MESSAGES);
  } catch {
    return [];
  }
}

export function saveTranscript(storage: StorageLike, messages: TranscriptMessage[]): void {
  const payload: StoredTranscript = {
    version: 1,
    messages: messages.slice(-MAX_TRANSCRIPT_MESSAGES),
  };
  storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(payload));
}

export function clearTranscript(storage: StorageLike): void {
  storage.removeItem(TRANSCRIPT_STORAGE_KEY);
}
