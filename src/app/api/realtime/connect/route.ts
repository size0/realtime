import { checkConnectionRateLimit } from "@/lib/rate-limit";
import { getRequestSession } from "@/lib/auth-session";
import { recordUsage, usageAllowance } from "@/lib/auth-store";
import { isRealtimeVoice } from "@/types/realtime";
import {
  createQwenRealtimeUrl,
  DEFAULT_QWEN_REALTIME_MODEL,
  isQwenRealtimeModel,
  isValidWorkspaceId,
  type QwenRegion,
} from "@/lib/realtime-session";
import { DEFAULT_REALTIME_VOICE } from "@/lib/qwen-session";

export const runtime = "nodejs";

const MAX_SDP_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;

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

function mapUpstreamError(status: number): { code: string; message: string; status: number } {
  if (status === 400) {
    return { code: "INVALID_SDP", message: "千问未接受浏览器生成的连接信息。", status: 400 };
  }
  if (status === 401) {
    return { code: "QWEN_AUTH", message: "百炼 API Key 无效。", status: 502 };
  }
  if (status === 403) {
    return {
      code: "QWEN_ACCESS",
      message: "当前百炼账号未获得该 Realtime 模型或 WebRTC 接入权限。",
      status: 502,
    };
  }
  if (status === 404) {
    return {
      code: "QWEN_WORKSPACE",
      message: "百炼业务空间 ID、地域或 WebRTC 接入地址不正确。",
      status: 502,
    };
  }
  if (status === 429) {
    return { code: "RATE_LIMITED", message: "实时语音服务当前请求过多。", status: 429 };
  }
  return { code: "QWEN_UNAVAILABLE", message: "千问实时语音服务暂时不可用。", status: 502 };
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!origin || origin.replace(/\/$/, "") !== expectedOrigin(request)) {
    return errorResponse("INVALID_ORIGIN", "请求来源不匹配。", 403);
  }

  const session = await getRequestSession(request);
  if (!session) return errorResponse("UNAUTHENTICATED", "请先登录。", 401);

  const voice = new URL(request.url).searchParams.get("voice") ?? DEFAULT_REALTIME_VOICE;
  if (!isRealtimeVoice(voice)) {
    return errorResponse("INVALID_VOICE", "请选择支持的音色。", 400);
  }

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim();
  if (contentType !== "application/sdp") {
    return errorResponse("INVALID_SDP", "请求必须使用 application/sdp。", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_SDP_BYTES) {
    return errorResponse("INVALID_SDP", "SDP 内容过大。", 413);
  }

  const rateLimit = checkConnectionRateLimit(`${clientIdentifier(request)}:${session.user.id}`);
  if (!rateLimit.allowed) {
    return errorResponse("RATE_LIMITED", "连接请求过于频繁。", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  const allowance = usageAllowance(session.user, "realtimeConnections");
  if (!allowance.allowed) {
    return errorResponse(
      "GUEST_DAILY_LIMIT",
      `今日访客语音连接额度已用完（${allowance.limit} 次），请明天再试。`,
      429,
    );
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return errorResponse("MISSING_API_KEY", "服务端尚未配置百炼 API Key。", 503);
  }

  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
  if (!workspaceId) {
    return errorResponse(
      "MISSING_WORKSPACE_ID",
      "服务端尚未配置百炼业务空间 ID。",
      503,
    );
  }
  if (!isValidWorkspaceId(workspaceId)) {
    return errorResponse("INVALID_SERVER_CONFIG", "百炼业务空间 ID 格式无效。", 503);
  }

  const modelValue =
    process.env.DASHSCOPE_REALTIME_MODEL?.trim() || DEFAULT_QWEN_REALTIME_MODEL;
  if (!isQwenRealtimeModel(modelValue)) {
    return errorResponse("INVALID_SERVER_CONFIG", "千问 Realtime 模型配置无效。", 503);
  }

  const regionValue = process.env.DASHSCOPE_REGION?.trim() || "cn-beijing";
  if (regionValue !== "cn-beijing" && regionValue !== "ap-southeast-1") {
    return errorResponse("INVALID_SERVER_CONFIG", "百炼地域配置无效。", 503);
  }

  const offerSdp = await request.text();
  if (!offerSdp.startsWith("v=0") || new TextEncoder().encode(offerSdp).byteLength > MAX_SDP_BYTES) {
    return errorResponse("INVALID_SDP", "SDP offer 无效。", 400);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(
      createQwenRealtimeUrl(workspaceId, modelValue, regionValue as QwenRegion),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/sdp",
        },
        body: offerSdp,
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (!upstream.ok) {
      const mapped = mapUpstreamError(upstream.status);
      return errorResponse(mapped.code, mapped.message, mapped.status);
    }

    const answerSdp = await upstream.text();
    if (!answerSdp.startsWith("v=0")) {
      return errorResponse("QWEN_UNAVAILABLE", "实时语音服务返回了无效连接信息。", 502);
    }

    await recordUsage(session.user.id, "realtimeConnections");
    return new Response(answerSdp, {
      status: 200,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    return errorResponse(
      "QWEN_UNAVAILABLE",
      isTimeout ? "连接千问实时语音服务超时。" : "无法连接千问实时语音服务。",
      502,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
