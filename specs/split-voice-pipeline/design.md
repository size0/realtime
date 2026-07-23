# 百聆式拆分语音链路设计

## 总体结构

```text
Browser
  ├─ AudioWorklet: 麦克风 -> 16k PCM
  ├─ WebSocket /voice-ws
  │    ├─ binary: PCM 输入
  │    ├─ JSON: VAD/ASR/TTS 控制与状态
  │    └─ binary: 24k PCM 输出
  ├─ POST /api/reply: 文本回答与模型路由
  └─ WebAudio: PCM 排队播放、插话立即取消

Nginx
  ├─ / -> Next.js :3502
  └─ /voice-ws -> Python voice-worker :3503/ws

Next.js
  ├─ 账户、访客、后台、字幕与 Qwen Realtime 回退
  ├─ POST /api/voice/token
  └─ POST /api/reply: economy/strong 自动路由

Python voice-worker
  ├─ HMAC token + Origin 校验
  ├─ Silero VAD
  ├─ SenseVoice/FunASR
  └─ Qwen3 TTS Realtime (Cherry, PCM 24k)
```

## WebSocket 协议

### 客户端到 worker

- 二进制帧：16kHz、mono、signed 16-bit little-endian PCM。
- JSON 帧：
  - `{"type":"configure","voice":"Cherry"}`
  - `{"type":"synthesize","responseId":"...","text":"..."}`
  - `{"type":"cancel"}`
  - `{"type":"stop"}`

### worker 到客户端

- 二进制帧：24kHz、mono、signed 16-bit little-endian PCM。
- JSON 帧：
  - `ready`: 模型准备完成。
  - `speech_started`: VAD 检测到用户开始讲话。
  - `speech_stopped`: 一轮音频已封口，包含 `utteranceId`。
  - `transcript`: ASR 完成，包含 `utteranceId` 和 `text`。
  - `audio_start`: 某个回答句子开始返回音频。
  - `audio_done`: 某个回答句子完成。
  - `interrupted`: TTS 队列已取消。
  - `error`: 稳定错误码和中文消息。

所有 JSON 都含 `type`；服务端生成的业务事件含随机 `eventId`，前端去重。

## 音频处理

### 输入

- `getUserMedia` 请求 `echoCancellation`、`noiseSuppression`、`autoGainControl`、`channelCount=1`。
- AudioWorklet 每次接收浏览器原始 float samples，在 worklet 内使用线性插值重采样到 16kHz，再转 Int16。
- 每 20–40ms 聚合后发送，WebSocket 缓冲超过阈值时丢弃旧输入并显示网络繁忙提示，避免无限堆积。

### VAD 与 ASR

- Silero VAD 以 512 samples（32ms）为窗口。
- 开始讲话后保存 PCM 到内存；结束后补齐 speech padding 并限制：
  - 最短 240ms；
  - 最长 45s；
  - 单轮最大 1.5MB。
- ASR 在线程池运行，避免阻塞 WebSocket 事件循环。
- worker 启动时加载模型。健康检查分别报告 `vad`、`asr`、`tts_configured`，但不返回路径或密钥。

## TTS

- 提供 `TtsProvider` 接口，使音色层和回答模型完全分离。
- 首个实现为 `QwenRealtimeTtsProvider`：
  - model: `qwen3-tts-instruct-flash-realtime`
  - voice: `Cherry`
  - mode: `commit`
  - format: PCM 24000Hz mono 16-bit
  - language: Auto
  - instructions: 温柔、克制、像深夜朋友，避免客服播报感
- 每次 `synthesize` 只提交一个完整自然句；前端按句顺序提交。
- SDK callback 所在线程通过 `asyncio.run_coroutine_threadsafe` 把 PCM 和状态安全送回 FastAPI 事件循环。
- `cancel` 使当前生成代次失效，后续旧回调音频会被丢弃，并清空文本缓冲。

## 文本模型路由

`/api/reply` 增加确定性的本地复杂度分类，不额外调用分类模型：

- `strong`：
  - 明确要求方案、比较、分析、规划、代码、法律/医疗/金融等高风险内容；
  - 问题较长或同时包含多个约束；
  - 历史较长且问题需要承接复杂上下文。
- `economy`：
  - 情绪倾诉、陪伴、寒暄、短问题和一般生活聊天。

环境变量：

- `ECONOMY_REASONING_*`：默认便宜文本模型。
- `STRONG_REASONING_*`：默认沿用现有 GPT-5.5 提供商。
- 保留旧 `REASONING_*` 作为强模型兼容配置。

路由结果只返回 `{reply, model, tier}`，不返回密钥、上游 URL 或分类特征。

## 鉴权与防护

### 令牌

`POST /api/voice/token` 生成：

```json
{
  "version": 1,
  "subject": "user-id",
  "expiresAt": 1710000000000,
  "nonce": "base64url"
}
```

Token 形式为 `base64url(payload).base64url(hmac)`，使用 `VOICE_WORKER_SECRET`；未配置时允许使用 `SESSION_SECRET`，但生产文档建议分离。

### worker

- 握手参数只接收一个 `token`。
- Origin 必须精确匹配 `APP_ORIGIN`。
- 连接时验证签名、payload schema、过期时间（60 秒内）和最大时钟偏移。
- WebSocket 不接受客户端提供 userId。
- 使用进程内 nonce 缓存拒绝同一 token 重放；生产多实例需换 Redis。

## 回退与发布

1. 先发布代码，页面保留 Qwen Realtime 默认，worker 内部可独立健康检查。
2. 部署并预热 worker，确认 `/healthz` ready。
3. 把低成本模式设为 UI 默认；失败时用户可一键切换高保真模式。
4. 出现内存压力时优先保留 Qwen 回退，不在 3.6GB 服务器上部署本地 TTS。

