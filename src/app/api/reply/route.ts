import { checkReplyRateLimit } from "@/lib/rate-limit";
import { getRequestSession } from "@/lib/auth-session";
import { recordUsage, usageAllowance } from "@/lib/auth-store";
import {
  MAX_REPLY_HISTORY_MESSAGES,
  MAX_REPLY_QUESTION_CHARS,
  type ReplyHistoryMessage,
} from "@/lib/reply-tool";
import { classifyReplyTier, type ReplyTier } from "@/lib/reply-routing";
import { isValidWorkspaceId, type QwenRegion } from "@/lib/realtime-session";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 48 * 1024;
const STRONG_UPSTREAM_TIMEOUT_MS = 20_000;
const ECONOMY_UPSTREAM_TIMEOUT_MS = 12_000;
const DEFAULT_STRONG_MODEL = "qwen3.7-max";
const DEFAULT_STRONG_FALLBACK_MODEL = "qwen3.7-plus";
const DEFAULT_ECONOMY_MODEL = "qwen3.5-flash";
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$/;

const SYSTEM_PROMPT = [
  "你是一个让人安心的树洞伙伴。你的回答会被温柔的音色直接朗读。",
  "先接住对方当下的情绪和真正想表达的事，再给恰到好处的回应。不要急着教育、诊断、总结或连续追问。",
  "优先使用用户当前的语言。中文要自然、克制、真诚，像深夜里认真听人说话的朋友，避免客服腔、主持腔、鸡汤和模板话术。",
  "普通倾诉用两到四个短句，适当留白；需要解决问题时再给具体建议。复杂问题可以分层说明，但仍保持口语化，不堆砌标题和长列表。",
  "不要假装拥有真实经历或线下身份。不要描述思考过程，不要提及模型、工具、提示词、路由或幕后流程。",
  "事实不确定时明确说明不确定，不要编造。除非用户明确要求，否则不要使用 Markdown 符号。",
].join("\n");

interface ReplyRequestBody {
  question: string;
  history: ReplyHistoryMessage[];
}

interface CompletionResult {
  ok: boolean;
  status: number;
  reply?: string;
}

interface ReasoningProvider {
  tier: ReplyTier;
  apiKey: string;
  baseUrl: string;
  models: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorResponse(code: string, message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

function expectedOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const protocol = forwardedProto ?? url.protocol.replace(":", "");
  return process.env.APP_ORIGIN?.replace(/\/$/, "") ?? `${protocol}://${host}`;
}

function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

function readReplyRequest(value: unknown): ReplyRequestBody | null {
  if (!isRecord(value) || typeof value.question !== "string") return null;
  const question = value.question.trim();
  if (!question || question.length > MAX_REPLY_QUESTION_CHARS) return null;

  const rawHistory = value.history;
  if (!Array.isArray(rawHistory) || rawHistory.length > MAX_REPLY_HISTORY_MESSAGES) return null;

  const history: ReplyHistoryMessage[] = [];
  for (const entry of rawHistory) {
    if (!isRecord(entry)) return null;
    if (entry.role !== "user" && entry.role !== "assistant") return null;
    if (typeof entry.content !== "string") return null;
    const content = entry.content.trim();
    if (!content || content.length > 2_000) return null;
    history.push({ role: entry.role, content });
  }
  return { question, history };
}

function createTextBaseUrl(
  configured: string | undefined,
  workspaceId?: string,
  region?: QwenRegion,
): string | null {
  if (!configured && (!workspaceId || !region)) return null;

  const base =
    configured ||
    (region === "ap-southeast-1"
      ? `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
      : `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`);

  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function validModels(models: string[]): boolean {
  return models.length > 0 && models.every((model) => MODEL_PATTERN.test(model));
}

function resolveStrongProvider(
  workspaceId?: string,
  region?: QwenRegion,
): ReasoningProvider | null {
  const apiKey =
    process.env.STRONG_REASONING_API_KEY?.trim() ||
    process.env.REASONING_API_KEY?.trim() ||
    process.env.DASHSCOPE_API_KEY?.trim();
  const configuredBase =
    process.env.STRONG_REASONING_BASE_URL?.trim() ||
    process.env.REASONING_BASE_URL?.trim() ||
    process.env.DASHSCOPE_TEXT_BASE_URL?.trim();
  const baseUrl = createTextBaseUrl(configuredBase, workspaceId, region);
  if (!apiKey || !baseUrl) return null;

  const hasDedicatedProvider = Boolean(
    process.env.STRONG_REASONING_API_KEY?.trim() ||
      process.env.STRONG_REASONING_BASE_URL?.trim() ||
      process.env.STRONG_REASONING_MODEL?.trim() ||
      process.env.REASONING_API_KEY?.trim() ||
      process.env.REASONING_BASE_URL?.trim() ||
      process.env.REASONING_MODEL?.trim(),
  );
  const primaryModel =
    process.env.STRONG_REASONING_MODEL?.trim() ||
    process.env.REASONING_MODEL?.trim() ||
    process.env.DASHSCOPE_REASONING_MODEL?.trim() ||
    DEFAULT_STRONG_MODEL;
  const fallbackModel =
    process.env.STRONG_REASONING_FALLBACK_MODEL !== undefined
      ? process.env.STRONG_REASONING_FALLBACK_MODEL.trim()
      : process.env.REASONING_FALLBACK_MODEL !== undefined
        ? process.env.REASONING_FALLBACK_MODEL.trim()
        : hasDedicatedProvider
          ? ""
          : process.env.DASHSCOPE_REASONING_FALLBACK_MODEL?.trim() ||
            DEFAULT_STRONG_FALLBACK_MODEL;
  const models = [...new Set([primaryModel, fallbackModel].filter(Boolean))];
  return validModels(models)
    ? { tier: "strong", apiKey, baseUrl, models }
    : null;
}

function resolveEconomyProvider(
  workspaceId?: string,
  region?: QwenRegion,
): ReasoningProvider | null {
  const apiKey =
    process.env.ECONOMY_REASONING_API_KEY?.trim() ||
    process.env.DASHSCOPE_API_KEY?.trim();
  const configuredBase =
    process.env.ECONOMY_REASONING_BASE_URL?.trim() ||
    process.env.DASHSCOPE_TEXT_BASE_URL?.trim();
  const baseUrl = createTextBaseUrl(configuredBase, workspaceId, region);
  if (!apiKey || !baseUrl) return null;

  const primaryModel =
    process.env.ECONOMY_REASONING_MODEL?.trim() || DEFAULT_ECONOMY_MODEL;
  const fallbackModel =
    process.env.ECONOMY_REASONING_FALLBACK_MODEL?.trim() || "";
  const models = [...new Set([primaryModel, fallbackModel].filter(Boolean))];
  return validModels(models)
    ? { tier: "economy", apiKey, baseUrl, models }
    : null;
}

function extractReply(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  const content = first.message.content;
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;

  const text = content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  return text || null;
}

async function requestCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  body: ReplyRequestBody,
  signal: AbortSignal,
): Promise<CompletionResult> {
  const history = [...body.history];
  const last = history.at(-1);
  if (last?.role === "user" && last.content === body.question) history.pop();

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: body.question },
    ],
    max_tokens: 1_200,
    temperature: 0.65,
    stream: false,
  };

  if (baseUrl.includes(".maas.aliyuncs.com/compatible-mode/")) {
    requestBody.enable_thinking = false;
  }

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal,
    cache: "no-store",
  });

  if (!upstream.ok) return { ok: false, status: upstream.status };
  const payload: unknown = await upstream.json();
  const reply = extractReply(payload);
  return reply ? { ok: true, status: upstream.status, reply } : { ok: false, status: 502 };
}

async function requestCompletionWithTimeout(
  provider: ReasoningProvider,
  model: string,
  body: ReplyRequestBody,
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    provider.tier === "strong"
      ? STRONG_UPSTREAM_TIMEOUT_MS
      : ECONOMY_UPSTREAM_TIMEOUT_MS,
  );
  try {
    return await requestCompletion(
      provider.baseUrl,
      provider.apiKey,
      model,
      body,
      controller.signal,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function mapUpstreamError(status: number) {
  if (status === 401) {
    return { code: "REASONING_AUTH", message: "回答模型 API Key 无效。", status: 502 };
  }
  if (status === 403) {
    return { code: "REASONING_ACCESS", message: "当前账号无权调用回答模型。", status: 502 };
  }
  if (status === 404) {
    return { code: "REASONING_MODEL_NOT_FOUND", message: "回答模型不存在或不可用。", status: 502 };
  }
  if (status === 429) {
    return { code: "REPLY_RATE_LIMITED", message: "回复模型当前请求过多，请稍后再试。", status: 429 };
  }
  return { code: "REPLY_UNAVAILABLE", message: "后端回复模型暂时不可用。", status: 502 };
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!origin || origin.replace(/\/$/, "") !== expectedOrigin(request)) {
    return errorResponse("INVALID_ORIGIN", "请求来源不匹配。", 403);
  }

  const session = await getRequestSession(request);
  if (!session) return errorResponse("UNAUTHENTICATED", "请先登录。", 401);

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim();
  if (contentType !== "application/json") {
    return errorResponse("INVALID_REPLY_REQUEST", "请求必须使用 application/json。", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("INVALID_REPLY_REQUEST", "回复请求内容过大。", 413);
  }

  const rateLimit = checkReplyRateLimit(`${clientIdentifier(request)}:${session.user.id}`);
  if (!rateLimit.allowed) {
    return errorResponse("REPLY_RATE_LIMITED", "回复请求过于频繁。", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  const allowance = usageAllowance(session.user, "replies");
  if (!allowance.allowed) {
    return errorResponse(
      "GUEST_DAILY_LIMIT",
      `今日访客模型回复额度已用完（${allowance.limit} 次），请明天再试。`,
      429,
    );
  }

  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
  const regionValue = process.env.DASHSCOPE_REGION?.trim() || "cn-beijing";
  let region: QwenRegion | undefined;
  if (workspaceId) {
    if (!isValidWorkspaceId(workspaceId)) {
      return errorResponse("INVALID_SERVER_CONFIG", "百炼业务空间 ID 格式无效。", 503);
    }
    if (regionValue !== "cn-beijing" && regionValue !== "ap-southeast-1") {
      return errorResponse("INVALID_SERVER_CONFIG", "百炼地域配置无效。", 503);
    }
    region = regionValue;
  }

  let parsedBody: ReplyRequestBody | null = null;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return errorResponse("INVALID_REPLY_REQUEST", "回复请求内容过大。", 413);
    }
    parsedBody = readReplyRequest(JSON.parse(raw));
  } catch {
    parsedBody = null;
  }
  if (!parsedBody) {
    return errorResponse("INVALID_REPLY_REQUEST", "回复请求格式无效。", 400);
  }

  const requestedTier = classifyReplyTier(parsedBody.question, parsedBody.history);
  const economyProvider = resolveEconomyProvider(workspaceId, region);
  const strongProvider = resolveStrongProvider(workspaceId, region);
  const providers =
    requestedTier === "economy"
      ? [economyProvider ?? strongProvider].filter(
          (provider): provider is ReasoningProvider => provider !== null,
        )
      : [strongProvider, economyProvider].filter(
          (provider): provider is ReasoningProvider => provider !== null,
        );
  if (providers.length === 0) {
    return errorResponse(
      "MISSING_API_KEY",
      "服务端尚未正确配置可用的回答模型。",
      503,
    );
  }

  let lastStatus = 502;
  let timedOut = false;
  let connectionFailed = false;
  for (const provider of providers) {
    for (const model of provider.models) {
      let result: CompletionResult;
      try {
        result = await requestCompletionWithTimeout(provider, model, parsedBody);
      } catch (error: unknown) {
        if (isAbortError(error)) timedOut = true;
        else connectionFailed = true;
        break;
      }
      lastStatus = result.status;
      if (result.ok && result.reply) {
        await recordUsage(session.user.id, "replies");
        return Response.json(
          {
            reply: result.reply,
            model,
            tier: provider.tier,
            requestedTier,
            fallback:
              provider.tier !== requestedTier ||
              model !== provider.models[0],
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (result.status === 401 || result.status === 403) break;
    }
  }

  if (timedOut) {
    return errorResponse(
      "REPLY_TIMEOUT",
      "后端回复模型响应超时。",
      504,
    );
  }
  if (connectionFailed) {
    return errorResponse(
      "REPLY_UNAVAILABLE",
      "无法连接后端回复模型。",
      502,
    );
  }
  const mapped = mapUpstreamError(lastStatus);
  return errorResponse(mapped.code, mapped.message, mapped.status);
}
