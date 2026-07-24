const API_ERROR_MESSAGES: Record<string, string> = {
  MISSING_API_KEY: "服务端还没有配置可用的模型密钥。",
  MISSING_WORKSPACE_ID: "服务端还缺少模型业务空间配置。",
  INVALID_SERVER_CONFIG: "服务端模型配置无效，请联系管理员检查。",
  QWEN_AUTH: "语音供应商密钥无效，请联系管理员。",
  QWEN_ACCESS: "当前供应商账号没有相应模型权限。",
  QWEN_WORKSPACE: "模型业务空间或接入地址不正确。",
  RATE_LIMITED: "连接请求过于频繁，请稍后再试。",
  GUEST_DAILY_LIMIT: "今天的访客体验额度已经用完。",
  VOICE_QUOTA_EXHAUSTED: "可用语音时间已经用完，请在微信里继续聊。",
  QWEN_UNAVAILABLE: "语音服务暂时不可用，请稍后重试。",
  REPLY_RATE_LIMITED: "回复请求有点多，请稍后再说一次。",
  REPLY_TIMEOUT: "这次回应等得有点久，请再说一次。",
  REPLY_UNAVAILABLE: "暂时没有接住这句话，请稍后再说一次。",
  INVALID_REPLY_REQUEST: "回复请求格式无效，请重新连接。",
  INVALID_SDP: "浏览器生成的语音连接信息无效，请重新连接。",
  INVALID_VOICE: "当前陪伴角色不可用，请重新选择。",
  INVALID_ORIGIN: "当前页面来源未获准访问语音接口。",
  INVALID_CSRF: "页面会话已经过期，请刷新后重试。",
  VOICE_WORKER_NOT_CONFIGURED: "语音服务正在准备中，请稍后再试。",
  WORKER_WARMING_UP: "语音识别正在预热，请稍后再试。",
  TTS_NOT_CONFIGURED: "声音服务尚未配置，请联系管理员。",
  SESSION_ALREADY_ACTIVE: "这个账号已有一段通话正在进行。",
};

export function mapApiError(code: string | undefined, fallback?: string): string {
  if (code && API_ERROR_MESSAGES[code]) return API_ERROR_MESSAGES[code];
  return fallback || "暂时无法建立语音连接，请稍后重试。";
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
      return "语音连接超时，请检查网络后重试。";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "暂时无法建立语音连接，请稍后重试。";
}
