import { describe, expect, it } from "vitest";
import {
  clearTranscript,
  loadTranscript,
  saveTranscript,
  TRANSCRIPT_STORAGE_KEY,
  type StorageLike,
} from "@/lib/transcript-storage";
import type { TranscriptMessage } from "@/types/realtime";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("transcript storage", () => {
  it("round-trips valid text-only messages", () => {
    const storage = new MemoryStorage();
    const messages: TranscriptMessage[] = [
      { id: "one", role: "user", text: "你好", status: "complete", createdAt: 1 },
    ];
    saveTranscript(storage, messages);
    expect(loadTranscript(storage)).toEqual(messages);
  });

  it("ignores malformed or outdated payloads", () => {
    const storage = new MemoryStorage();
    storage.setItem(TRANSCRIPT_STORAGE_KEY, "not-json");
    expect(loadTranscript(storage)).toEqual([]);
    storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify({ version: 2, messages: [] }));
    expect(loadTranscript(storage)).toEqual([]);
  });

  it("limits persistence and can clear the current transcript", () => {
    const storage = new MemoryStorage();
    const messages: TranscriptMessage[] = Array.from({ length: 205 }, (_, index) => ({
      id: String(index),
      role: "assistant",
      text: String(index),
      status: "complete",
      createdAt: index,
    }));
    saveTranscript(storage, messages);
    expect(loadTranscript(storage)).toHaveLength(200);
    expect(loadTranscript(storage)[0]?.id).toBe("5");
    clearTranscript(storage);
    expect(loadTranscript(storage)).toEqual([]);
  });
});
