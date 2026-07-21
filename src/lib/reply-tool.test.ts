import { describe, expect, it, vi } from "vitest";
import {
  createFunctionCallOutputEvent,
  createReplyHistory,
  createResponseEvent,
  parseReplyToolArguments,
} from "@/lib/reply-tool";
import type { TranscriptMessage } from "@/types/realtime";

describe("reply tool helpers", () => {
  it("parses a valid question and rejects malformed arguments", () => {
    expect(parseReplyToolArguments(' { "question": " 你好 " } ')).toEqual({ question: "你好" });
    expect(() => parseReplyToolArguments("{}")).toThrow("缺少");
    expect(() => parseReplyToolArguments('{"question":"   "}')).toThrow("不能为空");
  });

  it("keeps only recent usable transcript context", () => {
    const messages: TranscriptMessage[] = Array.from({ length: 15 }, (_, index) => ({
      id: String(index),
      role: index % 2 === 0 ? "user" : "assistant",
      text: index === 14 ? "" : `消息 ${index}`,
      status: index === 13 ? "failed" : "complete",
      createdAt: index,
    }));
    const history = createReplyHistory(messages);
    expect(history).toHaveLength(12);
    expect(history[0]?.content).toBe("消息 1");
    expect(history.at(-1)?.content).toBe("消息 12");
  });

  it("creates Qwen tool output and response events", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "id" });
    expect(createFunctionCallOutputEvent("call_1", "答案")).toMatchObject({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "call_1", output: "答案" },
    });
    expect(createResponseEvent()).toMatchObject({ type: "response.create" });
    vi.unstubAllGlobals();
  });
});
