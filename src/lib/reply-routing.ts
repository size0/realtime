import type { ReplyHistoryMessage } from "@/lib/reply-tool";

export type ReplyTier = "economy" | "strong";

const HIGH_RISK_OR_TECHNICAL =
  /(法律|合同|诉讼|医疗|症状|用药|诊断|投资|理财|股票|税务|架构|代码|编程|数据库|部署|故障|漏洞|安全审计|算法|数学证明)/i;
const COMPLEX_REQUEST =
  /(详细分析|深入分析|对比|比较.+区别|完整方案|实施方案|规划|权衡|利弊|推导|原理|一步一步|多步骤|怎么实现|帮我设计)/i;
const MULTI_CONSTRAINT = /(同时|另外|并且|既要.+又要|不但.+还要|前提是|约束|分别)/i;
const TREEHOLE_TALK =
  /(难过|委屈|孤独|失恋|焦虑|想哭|睡不着|没人理解|陪我|聊聊天|心情|烦|累了|想念|不开心)/i;

export function classifyReplyTier(
  question: string,
  history: ReplyHistoryMessage[],
): ReplyTier {
  const normalized = question.trim();
  if (HIGH_RISK_OR_TECHNICAL.test(normalized)) return "strong";
  if (TREEHOLE_TALK.test(normalized) && normalized.length < 180) return "economy";

  let score = 0;
  if (normalized.length >= 100) score += 1;
  if (COMPLEX_REQUEST.test(normalized)) score += 2;
  if (MULTI_CONSTRAINT.test(normalized)) score += 1;
  if (history.length >= 10 && normalized.length >= 50) score += 1;
  if ((normalized.match(/[？?]/g) ?? []).length >= 3) score += 1;
  return score >= 2 ? "strong" : "economy";
}

