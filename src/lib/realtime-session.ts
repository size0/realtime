export const QWEN_REALTIME_MODELS = [
  "qwen3.5-omni-plus-realtime",
  "qwen3.5-omni-flash-realtime",
] as const;

export type QwenRealtimeModel = (typeof QWEN_REALTIME_MODELS)[number];
export type QwenRegion = "cn-beijing" | "ap-southeast-1";

export const DEFAULT_QWEN_REALTIME_MODEL: QwenRealtimeModel =
  "qwen3.5-omni-flash-realtime";

export function isQwenRealtimeModel(value: string): value is QwenRealtimeModel {
  return QWEN_REALTIME_MODELS.some((model) => model === value);
}

export function isValidWorkspaceId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{2,127}$/.test(value);
}

export function createQwenRealtimeUrl(
  workspaceId: string,
  model: QwenRealtimeModel = DEFAULT_QWEN_REALTIME_MODEL,
  region: QwenRegion = "cn-beijing",
): string {
  if (!isValidWorkspaceId(workspaceId)) throw new Error("Invalid DashScope Workspace ID");
  const hostname =
    region === "ap-southeast-1"
      ? `${workspaceId}.ap-southeast-1.maas.aliyuncs.com`
      : `${workspaceId}.cn-beijing.maas.aliyuncs.com`;
  const url = new URL(`https://${hostname}/api/v1/webrtc/realtime`);
  url.searchParams.set("model", model);
  return url.toString();
}
