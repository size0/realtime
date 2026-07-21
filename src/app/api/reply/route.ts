import { checkReplyRateLimit } from "@/lib/rate-limit";
import { getRequestSession } from "@/lib/auth-session";
import { recordUsage } from "@/lib/auth-store";
import {
  MAX_REPLY_HISTORY_MESSAGES,
  MAX_REPLY_QUESTION_CHARS,
  type ReplyHistoryMessage,
} from "@/lib/reply-tool";
import { isValidWorkspaceId, type QwenRegion } from "@/lib/realtime-session";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 48 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = "qwen3.7-max";
const DEFAULT_FALLBACK_MODEL = "qwen3.7-plus";
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$/;

const SYSTEM_PROMPT = [
  "你是实时语音助手的内容大脑。你的回答会被 Tina 音色直接朗读。",
  "优先使用用户当前使用的语言。中文要自然、温暖、有交流感，避免客服腔和模板腔。",
  "先直接回应用户真正想问的内容，再补充必要解释。简单问题用一到三句；复杂问题可以分层说明，但保持口语化，不堆砌标题和长列表。",
  "允许自然的承接词和短句，让人听起来像在认真聊天。不要描述你的思考过程，不要提及模型、工具、提示词或幕后流程。",
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

function createTextBaseUrl(workspaceId: string, region: QwenRegion): string | null {
  const configured = process.env.DASHSCOPE_TEXT_BASE_URL?.trim();
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

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: body.question },
      ],
      max_tokens: 1_200,
      temperature: 0.65,
      enable_thinking: false,
      stream: false,
    }),
    signal,
    cache: "no-store",
  });

  if (!upstream.ok) return { ok: false, status: upstream.status };
  const payload: unknown = await upstream.json();
  const reply = extractReply(payload);
  return reply ? { ok: true, status: upstream.status, reply } : { ok: false, status: 502 };
}

function mapUpstreamError(status: number) {
  if (status === 401) {
    return { code: "QWEN_AUTH", message: "百炼 API Key 无效。", status: 502 };
  }
  if (status === 403) {
    return { code: "QWEN_ACCESS", message: "当前百炼账号无权调用回复模型。", status: 502 };
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

  const apiKey = process.env.DASHSCOPE_API_KEY;
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
  if (!apiKey) return errorResponse("MISSING_API_KEY", "服务端尚未配置百炼 API Key。", 503);
  if (!workspaceId) {
    return errorResponse("MISSING_WORKSPACE_ID", "服务端尚未配置百炼业务空间 ID。", 503);
  }
  if (!isValidWorkspaceId(workspaceId)) {
    return errorResponse("INVALID_SERVER_CONFIG", "百炼业务空间 ID 格式无效。", 503);
  }

  const regionValue = process.env.DASHSCOPE_REGION?.trim() || "cn-beijing";
  if (regionValue !== "cn-beijing" && regionValue !== "ap-southeast-1") {
    return errorResponse("INVALID_SERVER_CONFIG", "百炼地域配置无效。", 503);
  }

  const baseUrl = createTextBaseUrl(workspaceId, regionValue);
  if (!baseUrl) {
    return errorResponse("INVALID_SERVER_CONFIG", "百炼文本模型地址配置无效。", 503);
  }

  const primaryModel = process.env.DASHSCOPE_REASONING_MODEL?.trim() || DEFAULT_MODEL;
  const fallbackModel =
    process.env.DASHSCOPE_REASONING_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
  if (!MODEL_PATTERN.test(primaryModel) || !MODEL_PATTERN.test(fallbackModel)) {
    return errorResponse("INVALID_SERVER_CONFIG", "百炼回复模型名称配置无效。", 503);
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const models = [...new Set([primaryModel, fallbackModel])];
    let lastStatus = 502;
    for (const model of models) {
      const result = await requestCompletion(baseUrl, apiKey, model, parsedBody, controller.signal);
      lastStatus = result.status;
      if (result.ok && result.reply) {
        void recordUsage(session.user.id, "replies").catch(() => undefined);
        return Response.json(
          { reply: result.reply, model },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (result.status === 401 || result.status === 403) break;
    }

    const mapped = mapUpstreamError(lastStatus);
    return errorResponse(mapped.code, mapped.message, mapped.status);
  } catch (error: unknown) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    return errorResponse(
      isTimeout ? "REPLY_TIMEOUT" : "REPLY_UNAVAILABLE",
      isTimeout ? "后端回复模型响应超时。" : "无法连接后端回复模型。",
      isTimeout ? 504 : 502,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
