export const COMPANION_VOICES = ["breeze", "glow", "nightwatch"] as const;
export type CompanionVoice = (typeof COMPANION_VOICES)[number];
export type ConversationStatus = "active" | "completed" | "interrupted" | "failed";
export type ConversationRisk = "normal" | "elevated" | "crisis";
export type MessageSyncStatus = "local" | "syncing" | "synced" | "failed";

export const COMPANION_OPTIONS: ReadonlyArray<{
  value: CompanionVoice;
  name: string;
  description: string;
  greeting: string;
  providerVoice: "Serena" | "Cherry" | "Ethan";
}> = [
  {
    value: "breeze",
    name: "晚风",
    description: "轻柔、慢一点，适合安静倾诉",
    greeting: "慢慢说，我在听。",
    providerVoice: "Serena",
  },
  {
    value: "glow",
    name: "微光",
    description: "自然亲近，带一点明亮",
    greeting: "今天想从哪里聊起？",
    providerVoice: "Cherry",
  },
  {
    value: "nightwatch",
    name: "守夜",
    description: "温暖沉稳，回应更克制",
    greeting: "不用着急，我陪你待一会儿。",
    providerVoice: "Ethan",
  },
];

export function isCompanionVoice(value: unknown): value is CompanionVoice {
  return (
    typeof value === "string" &&
    (COMPANION_VOICES as readonly string[]).includes(value)
  );
}
