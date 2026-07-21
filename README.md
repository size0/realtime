# 声场 · Qwen Realtime Voice

一个带登录和管理后台的实时语音对话网页。浏览器通过 WebRTC 连接 Qwen3.5-Omni-Realtime，固定使用 Tina 音色；每轮内容先由 qwen3.7-max 生成，Max 不可用时回退 qwen3.7-plus，再交给 Tina 自然朗读。

## 功能

- Tina 固定声线、双向 WebRTC、实时字幕和插话打断
- Semantic VAD，静音 1500ms 后才判断用户说完
- qwen3.7-max 负责回复内容，Realtime 负责听、断句和说
- 管理员创建、启用或停用用户，并查看语音连接和模型回复次数
- 用户名密码登录，scrypt 密码哈希，HttpOnly + SameSite=Strict 签名会话
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
DASHSCOPE_REALTIME_MODEL=qwen3.5-omni-plus-realtime
DASHSCOPE_REASONING_MODEL=qwen3.7-max
DASHSCOPE_REASONING_FALLBACK_MODEL=qwen3.7-plus

SESSION_SECRET=至少32位随机字符串
ADMIN_USERNAME=admin
ADMIN_DISPLAY_NAME=管理员
ADMIN_PASSWORD=首次启动管理员密码
APP_DATA_FILE=.data/users.json
~~~

首次成功登录时会初始化管理员记录。之后修改环境变量中的 ADMIN_PASSWORD 不会覆盖已保存的密码。所有真实密钥、密码、会话和用户数据库都不能提交 Git。

## 本地启动

要求 Node.js 20.9 或更高版本。

~~~powershell
npm install
npm run dev
~~~

访问 http://localhost:3000/login。

## 页面与接口

- /login：用户登录
- /：实时语音对话，必须登录
- /admin：用户与用量管理，仅管理员
- POST /api/auth/login：登录并设置 HttpOnly Cookie
- POST /api/auth/logout：退出
- GET /api/auth/session：获取当前会话
- GET/POST/PATCH /api/admin/users：用户管理
- POST /api/realtime/connect：建立 Qwen WebRTC 会话
- POST /api/reply：调用 qwen3.7-max / Plus 生成回复内容

## 验证

~~~powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
~~~

生产部署必须使用 HTTPS，否则浏览器不会开放麦克风。公开运营前还应把进程内限流升级为 Redis 等分布式限流，并增加密码重置、审计日志、配额计费和备份。
