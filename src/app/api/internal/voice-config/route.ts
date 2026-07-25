import { getProductSettings } from "@/lib/product-admin";
import { jsonError } from "@/lib/request-security";
import { verifyVoiceWorkerSignature } from "@/lib/voice-worker-signature";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!verifyVoiceWorkerSignature(
    "",
    request.headers.get("x-voice-timestamp"),
    request.headers.get("x-voice-signature"),
  )) {
    return jsonError(
      "INVALID_VOICE_CONFIG_SIGNATURE",
      "语音配置请求签名无效。",
      401,
    );
  }
  const settings = getProductSettings();
  return Response.json(
    {
      voiceSettings: {
        vadSilenceMs: settings.vadSilenceMs,
        asrProvider: settings.asrProvider,
        asrModel: settings.asrModel,
        ttsProvider: settings.ttsProvider,
        ttsModel: settings.ttsModel,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
