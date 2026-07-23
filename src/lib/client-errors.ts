const API_ERROR_MESSAGES: Record<string, string> = {
  MISSING_API_KEY: "服务端还没有配置百炼 API Key。",
  MISSING_WORKSPACE_ID: "还缺少百炼业务空间 ID，请在百炼控制台复制后配置。",
  INVALID_SERVER_CONFIG: "千问服务端配置无效，请检查业务空间、地域和模型名称。",
  QWEN_AUTH: "百炼 API Key 无效，请重新创建并配置。",
  QWEN_ACCESS: "当前百炼账号未开通该 Realtime 模型或 WebRTC 权限。",
  QWEN_WORKSPACE: "百炼业务空间 ID、地域或 WebRTC 接入地址不正确。",
  RATE_LIMITED: "连接请求过于频繁，请稍后再试。",
  GUEST_DAILY_LIMIT: "今天的访客体验额度已用完，请明天再来。",
  QWEN_UNAVAILABLE: "千问实时语音服务暂时不可用，请稍后重试。",
  REPLY_RATE_LIMITED: "后端回复模型请求过多，请稍后再说一次。",
  REPLY_TIMEOUT: "后端回复模型响应超时，请再说一次。",
  REPLY_UNAVAILABLE: "后端回复模型暂时不可用，请稍后再说一次。",
  INVALID_REPLY_REQUEST: "后端回复请求格式无效，请重新连接。",
  INVALID_SDP: "浏览器生成的语音连接信息无效，请重新连接。",
  INVALID_VOICE: "当前音色不可用，请重新选择。",
  INVALID_ORIGIN: "当前页面来源未获准访问语音接口。",
  INVALID_CSRF: "页面会话已过期，请刷新后重试。",
  VOICE_WORKER_NOT_CONFIGURED: "低成本语音服务尚未配置，请切换高保真模式。",
  WORKER_WARMING_UP: "低成本语音模型正在预热，请稍后重试或切换高保真模式。",
  TTS_NOT_CONFIGURED: "固定音色服务尚未配置，请切换高保真模式。",
  SESSION_ALREADY_ACTIVE: "该账号已有语音会话，请先结束另一端通话。",
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
