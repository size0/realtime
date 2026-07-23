# 声场 · 树洞实时语音

一个带自动访客登录和管理后台的树洞语音对话网页。默认使用参考百聆思路重新实现的拆分链路：本地 VAD/ASR、可路由的文本大模型和独立固定 TTS 音色；原有 Qwen Omni Realtime 保留为高保真回退。

## 功能

- 默认省钱模式：浏览器 PCM → Silero VAD → 本机 SenseVoice/FunASR → 文本模型 → Qwen3 TTS
- 静音 1100ms 后判断用户说完，短暂停顿不会马上抢答
- 普通树洞聊天走 `qwen3.5-flash`，复杂或高风险问题自动升级到 GPT-5.5
- 固定 `Cherry` 树洞音色，回答按自然句逐句流式生成和播放
- AI 朗读时用户开口会立即停止本地音频并取消未完成回答
- 高保真回退模式保留 10 个 Qwen3.5 Realtime 声线、WebRTC、字幕和打断
- 管理员创建、启用或停用用户，并查看语音连接和模型回复次数
- 普通用户首次访问自动生成访客账号；管理员和已有账号保留用户名密码登录
- 访客创建频率限制及每日连接/回复额度，HttpOnly + SameSite=Strict 签名会话
- 同源校验、CSRF 令牌、请求体上限、接口限流和安全响应头
- 最近 200 条文字记录仅保存在浏览器，不保存音频

## 配置

~~~powershell
Copy-Item .env.example .env.local
~~~

至少配置：

~~~dotenv
DASHSCOPE_API_KEY=sk-your-real-key
DASHSCOPE_WORKSPACE_ID=llm-your-workspace-id
DASHSCOPE_REGION=cn-beijing
DASHSCOPE_REALTIME_MODEL=qwen3.5-omni-flash-realtime

ECONOMY_REASONING_API_KEY=sk-your-dashscope-api-key
ECONOMY_REASONING_BASE_URL=https://llm-your-workspace-id.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
ECONOMY_REASONING_MODEL=qwen3.5-flash

REASONING_API_KEY=sk-your-reasoning-provider-key
REASONING_BASE_URL=https://airelvo.cc/v1
REASONING_MODEL=gpt-5.5
REASONING_FALLBACK_MODEL=gpt-5.4

VOICE_WORKER_SECRET=至少32位的另一组随机字符串
VOICE_ASR_MODEL=FunAudioLLM/SenseVoiceSmall
VOICE_MIN_SILENCE_MS=1100
VOICE_TTS_MODEL=qwen3-tts-instruct-flash-realtime
VOICE_TTS_VOICE=Cherry

SESSION_SECRET=至少32位随机字符串
ADMIN_USERNAME=admin
ADMIN_DISPLAY_NAME=管理员
ADMIN_PASSWORD=首次启动管理员密码
APP_DATA_FILE=.data/users.json
GUEST_DAILY_CONNECTION_LIMIT=10
GUEST_DAILY_REPLY_LIMIT=50
APP_ORIGIN=https://voice.example.com
~~~

首次成功登录时会初始化管理员记录。之后修改环境变量中的 ADMIN_PASSWORD 不会覆盖已保存的密码。所有真实密钥、密码、会话和用户数据库都不能提交 Git。

## 本地启动

要求 Node.js 20.9 或更高版本。

~~~powershell
npm install
npm run dev
~~~

另开一个终端启动拆分语音 worker：

~~~powershell
Set-Location voice-worker
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn voice_worker.main:app --host 127.0.0.1 --port 3503
~~~

开发环境需要把 `/voice-ws` 反向代理到 `127.0.0.1:3503/ws`；也可以先用高保真回退模式验证页面。生产 Nginx 和 systemd 模板位于 `deploy/`。

## 页面与接口

- /login：管理员或已有账号登录
- /：自动建立访客会话并进入实时语音对话
- /admin：用户与用量管理，仅管理员
- POST /api/auth/login：登录并设置 HttpOnly Cookie
- POST /api/auth/guest：限流创建访客账号并设置 HttpOnly Cookie
- POST /api/auth/logout：退出
- GET /api/auth/session：获取当前会话
- GET/POST/PATCH /api/admin/users：用户管理
- POST /api/realtime/connect：建立 Qwen WebRTC 会话
- POST /api/voice/token：签发 60 秒有效、一次性使用的 worker 连接令牌
- POST /api/reply：普通/强模型自动路由，返回实际 `tier` 与模型名
- WS /voice-ws：受 Origin、HMAC 令牌、大小和时长限制的 PCM/VAD/ASR/TTS 通道

## 验证

~~~powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
Set-Location voice-worker
python -m pytest -q
~~~

生产部署必须使用 HTTPS，否则浏览器不会开放麦克风。本实现没有直接复制百聆源码；百聆仓库的 MIT LICENSE 与 README 商用声明存在冲突，商用前应自行完成法律确认。公开运营前还应把进程内限流和一次性 nonce 缓存升级为 Redis 等分布式存储，并增加密码重置、审计日志、配额计费和备份。

Qwen3 TTS Realtime 的 `commit` 模式适合由客户端按句提交，官方 SDK 输出 24kHz 单声道 PCM；详细能力与计费以[阿里云实时语音合成文档](https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide)和[模型价格页](https://help.aliyun.com/zh/model-studio/model-pricing)为准。
