const API_ERROR_MESSAGES: Record<string, string> = {
  MISSING_API_KEY: "服务端还没有配置百炼 API Key。",
  MISSING_WORKSPACE_ID: "还缺少百炼业务空间 ID，请在百炼控制台复制后配置。",
  INVALID_SERVER_CONFIG: "千问服务端配置无效，请检查业务空间、地域和模型名称。",
  QWEN_AUTH: "百炼 API Key 无效，请重新创建并配置。",
  QWEN_ACCESS: "当前百炼账号未开通该 Realtime 模型或 WebRTC 权限。",
  QWEN_WORKSPACE: "百炼业务空间 ID、地域或 WebRTC 接入地址不正确。",
  RATE_LIMITED: "连接请求过于频繁，请稍后再试。",
  QWEN_UNAVAILABLE: "千问实时语音服务暂时不可用，请稍后重试。",
  INVALID_SDP: "浏览器生成的语音连接信息无效，请重新连接。",
  INVALID_ORIGIN: "当前页面来源未获准访问语音接口。",
  INVALID_VOICE: "所选音色不可用，请更换后重试。",
};

export function mapApiError(code: string | undefined, fallback?: string): string {
  if (code && API_ERROR_MESSAGES[code]) return API_ERROR_MESSAGES[code];
  return fallback || "无法建立实时语音连接，请重试。";
}

export function mapBrowserError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "麦克风权限被拒绝，请在浏览器地址栏中允许后重试。";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "没有检测到可用麦克风，请连接设备后重试。";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "麦克风正被其他应用占用，请关闭占用后重试。";
    }
    if (error.name === "AbortError") {
      return "连接实时语音服务超时，请检查网络后重试。";
    }
  }

  if (error instanceof Error && error.message) return error.message;
  return "无法建立实时语音连接，请重试。";
}
