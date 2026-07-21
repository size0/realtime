import type { TranscriptMessage } from "@/types/realtime";

export const MAX_REPLY_QUESTION_CHARS = 6_000;
export const MAX_REPLY_HISTORY_MESSAGES = 12;
const MAX_HISTORY_MESSAGE_CHARS = 2_000;

export interface ReplyHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ReplyToolArguments {
  question: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseReplyToolArguments(value: string): ReplyToolArguments {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || typeof parsed.question !== "string") {
    throw new Error("工具参数中缺少用户问题。");
  }

  const question = parsed.question.trim();
  if (!question) throw new Error("用户问题不能为空。");
  if (question.length > MAX_REPLY_QUESTION_CHARS) {
    throw new Error("用户问题过长，请分段提问。");
  }
  return { question };
}

export function createReplyHistory(messages: TranscriptMessage[]): ReplyHistoryMessage[] {
  return messages
    .filter((message) => message.text.trim().length > 0 && message.status !== "failed")
    .slice(-MAX_REPLY_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.text.trim().slice(0, MAX_HISTORY_MESSAGE_CHARS),
    }));
}

export function createFunctionCallOutputEvent(callId: string, output: string) {
  return {
    event_id: `event_${crypto.randomUUID()}`,
    type: "conversation.item.create" as const,
    item: {
      type: "function_call_output" as const,
      call_id: callId,
      output,
    },
  };
}

export function createResponseEvent() {
  return {
    event_id: `event_${crypto.randomUUID()}`,
    type: "response.create" as const,
  };
}
