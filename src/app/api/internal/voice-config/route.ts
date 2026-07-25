import { getProductSettings } from "@/lib/product-admin";
import { getProviderConfig } from "@/lib/provider-config";
import { jsonError } from "@/lib/request-security";
import { verifyVoiceWorkerSignature } from "@/lib/voice-worker-signature";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!verifyVoiceWorkerSignature(
    "",
    request.headers.get("x-voice-timestamp"),
    request.headers.get("x-voice-signature"),
    request.headers.get("x-voice-nonce"),
    request.method,
    path,
  )) {
    return jsonError(
      "INVALID_VOICE_CONFIG_SIGNATURE",
      "语音配置请求签名无效。",
      401,
    );
  }
  const settings = getProductSettings();
  const providerConfig = getProviderConfig();
  return Response.json(
    {
      voiceSettings: {
        vadSilenceMs: settings.vadSilenceMs,
        vadThreshold: settings.vadThreshold,
        speechPadMs: settings.speechPadMs,
        asrProvider: settings.asrProvider,
        asrModel: settings.asrModel,
        ttsProvider: settings.ttsProvider,
        ttsModel: settings.ttsModel,
        ttsWsUrl: providerConfig.dashscope.ttsWsUrl,
        dashscopeApiKey: providerConfig.dashscope.apiKey,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
