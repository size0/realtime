import { describe, expect, it } from "vitest";
import {
  initialRealtimeState,
  isDuplicateRealtimeEvent,
  MAX_TRANSCRIPT_MESSAGES,
  mergeTranscript,
  parseRealtimeEvent,
  realtimeReducer,
} from "@/lib/realtime-events";
import type { TranscriptMessage } from "@/types/realtime";

describe("Qwen Realtime event handling", () => {
  it("parses assistant transcript events and preserves their event id", () => {
    expect(
      parseRealtimeEvent({
        event_id: "evt_1",
        type: "response.audio_transcript.delta",
        item_id: "assistant_1",
        delta: "你好",
      }),
    ).toEqual({
      eventId: "evt_1",
      type: "response.audio_transcript.delta",
      item_id: "assistant_1",
      delta: "你好",
    });
  });

  it("combines Qwen user text and stash into a replaceable preview", () => {
    expect(
      parseRealtimeEvent({
        event_id: "evt_user",
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "user_1",
        text: "今天",
        stash: "天气不错",
      }),
    ).toMatchObject({ item_id: "user_1", delta: "今天天气不错" });
  });

  it("normalizes response.text.done into a final transcript", () => {
    expect(
      parseRealtimeEvent({
        type: "response.text.done",
        item_id: "assistant_2",
        text: "完整回答",
      }),
    ).toMatchObject({ item_id: "assistant_2", transcript: "完整回答" });
  });

  it("parses completed reply tool calls with their authoritative arguments", () => {
    expect(
      parseRealtimeEvent({
        event_id: "evt_tool",
        type: "response.function_call_arguments.done",
        item_id: "tool_1",
        call_id: "call_1",
        name: "generate_reply",
        arguments: '{"question":"解释量子纠缠"}',
      }),
    ).toEqual({
      eventId: "evt_tool",
      type: "response.function_call_arguments.done",
      item_id: "tool_1",
      call_id: "call_1",
      name: "generate_reply",
      arguments: '{"question":"解释量子纠缠"}',
    });
  });

  it("rejects malformed boundary values", () => {
    expect(parseRealtimeEvent(null)).toBeNull();
    expect(parseRealtimeEvent({ type: "response.audio_transcript.delta" })).toBeNull();
    expect(parseRealtimeEvent({ type: 42 })).toBeNull();
  });

  it("deduplicates server events by event id", () => {
    const seen = new Set<string>();
    const event = parseRealtimeEvent({ event_id: "evt_same", type: "response.created" });
    expect(event).not.toBeNull();
    if (!event) return;
    expect(isDuplicateRealtimeEvent(event, seen)).toBe(false);
    expect(isDuplicateRealtimeEvent(event, seen)).toBe(true);
  });

  it("merges streaming deltas and replaces them with the final transcript", () => {
    const first = mergeTranscript([], {
      id: "item_1",
      role: "assistant",
      text: "你",
      mode: "append",
      createdAt: 1,
    });
    const second = mergeTranscript(first, {
      id: "item_1",
      role: "assistant",
      text: "好",
      mode: "append",
    });
    const final = mergeTranscript(second, {
      id: "item_1",
      role: "assistant",
      text: "你好。",
      mode: "replace",
      status: "complete",
    });
    expect(final).toEqual([
      { id: "item_1", role: "assistant", text: "你好。", status: "complete", createdAt: 1 },
    ]);
  });

  it("replaces changing user ASR previews instead of duplicating them", () => {
    const first = realtimeReducer(initialRealtimeState, {
      type: "server-event",
      event: {
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "user_2",
        delta: "今天",
      },
    });
    const second = realtimeReducer(first, {
      type: "server-event",
      event: {
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "user_2",
        delta: "今天天气",
      },
    });
    expect(second.messages[0]?.text).toBe("今天天气");
  });

  it("marks a streaming assistant reply interrupted when the user starts speaking", () => {
    const speaking = realtimeReducer(initialRealtimeState, {
      type: "server-event",
      event: {
        type: "response.audio_transcript.delta",
        item_id: "assistant_3",
        delta: "还没有说完",
      },
    });
    const interrupted = realtimeReducer(speaking, {
      type: "server-event",
      event: { type: "input_audio_buffer.speech_started" },
    });
    expect(interrupted.messages[0]?.status).toBe("interrupted");
    expect(interrupted.callStatus).toBe("listening");
  });

  it("keeps only the newest 200 messages", () => {
    const messages: TranscriptMessage[] = Array.from(
      { length: MAX_TRANSCRIPT_MESSAGES },
      (_, index) => ({
        id: `item_${index}`,
        role: "user",
        text: String(index),
        status: "complete",
        createdAt: index,
      }),
    );
    const next = mergeTranscript(messages, {
      id: "item_new",
      role: "assistant",
      text: "new",
      status: "complete",
    });
    expect(next).toHaveLength(MAX_TRANSCRIPT_MESSAGES);
    expect(next[0]?.id).toBe("item_1");
    expect(next.at(-1)?.id).toBe("item_new");
  });
});
