# 声场 · Qwen Realtime Voice MVP

一个原创深色界面的实时语音对话网页版。浏览器通过 WebRTC 与千问 Qwen3.5-Omni-Realtime 建立低延迟音频会话，支持自动判断说完、实时字幕和说话打断 AI。

## 功能

- WebRTC 双向语音，远端音频通过 RTP 直接播放
- Semantic VAD 自动断句与语义插话打断
- 用户流式转写与 AI 回复字幕增量显示
- 开始、结束、静音、字幕开关与通话前音色选择
- 麦克风权限、设备、网络、限流、密钥和业务空间错误提示
- 最近 200 条文字记录仅保存在当前浏览器，不保存音频
- 服务端代理百炼 SDP 接口，API Key 不进入浏览器

## 准备百炼配置

需要华北 2（北京）或新加坡地域的百炼 API Key，以及同地域的业务空间 ID。业务空间 ID 可在百炼控制台右上角的业务空间入口中复制。

~~~powershell
Copy-Item .env.example .env.local
~~~

编辑 .env.local：

~~~dotenv
DASHSCOPE_API_KEY=sk-your-real-key
DASHSCOPE_WORKSPACE_ID=llm-your-workspace-id
DASHSCOPE_REGION=cn-beijing
DASHSCOPE_REALTIME_MODEL=qwen3.5-omni-plus-realtime
~~~

.env.local 已被 Git 忽略，不要把真实 Key 提交到版本库。聊天记录或截图中出现过的 Key 建议在验收完成后轮换。

## 本地启动

要求 Node.js 20.9 或更高版本。

~~~powershell
npm install
npm run dev
~~~

访问 http://localhost:3000。麦克风只能在 localhost 或 HTTPS 页面中使用。

## 验证

~~~powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
~~~

Playwright 首次运行如果提示缺少浏览器：

~~~powershell
npx playwright install chromium
~~~

## 接口

POST /api/realtime/connect?voice=Tina

- 请求：Content-Type 为 application/sdp，正文为浏览器完成 ICE 收集后的 SDP offer
- 响应：Content-Type 为 application/sdp，正文为千问 SDP answer
- 音色白名单：Tina、Ethan、Theo Calm、Serena
- 默认模型：qwen3.5-omni-plus-realtime
- 浏览器等待服务端 session.created 后，通过 txt DataChannel 发送会话配置
- 会话固定启用输入转写、中文友好提示词、Semantic VAD 和 800ms 静音判断

接口会校验同源、限制 64 KiB 请求体，并对每个 IP 在 10 分钟内最多允许 6 次连接创建。该内存限流适合本地 MVP；公开部署前应替换为 Redis 等共享限流，并增加登录、用量额度和滥用防护。

## 隐私与限制

- 浏览器仅持久化字幕文本；媒体流只存在于当前通话内，结束时会停止所有音轨并释放连接。
- 输入字幕由内置 ASR 生成，仅用于显示，可能与模型实际理解略有差异。
- WebRTC 能否实际建连还取决于账号是否拥有对应模型和 WebRTC 接入权限。
- 没有业务空间 ID 时，可以验证界面、错误路径、单元测试和构建，但无法完成真实双向语音验收。

接口参数参考[阿里云 Qwen-Omni-Realtime 官方文档](https://help.aliyun.com/zh/model-studio/realtime)。
