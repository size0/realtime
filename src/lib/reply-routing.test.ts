import { describe, expect, it } from "vitest";
import { classifyReplyTier } from "@/lib/reply-routing";

describe("reply model routing", () => {
  it.each([
    "我今天有点难过，能陪我聊聊吗",
    "你觉得我该怎么和朋友开口？",
    "晚上好",
  ])("keeps ordinary treehole talk on the economy tier: %s", (question) => {
    expect(classifyReplyTier(question, [])).toBe("economy");
  });

  it.each([
    "帮我设计一个支持十万并发的语音系统架构，并分析成本和故障恢复方案",
    "这份合同的法律风险有哪些？请详细分析",
    "比较三种数据库方案的利弊，并给出迁移步骤",
  ])("routes complex or high-stakes questions to the strong tier: %s", (question) => {
    expect(classifyReplyTier(question, [])).toBe("strong");
  });
});

