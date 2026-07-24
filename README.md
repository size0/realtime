# 树洞实时语音

面向微信内匿名使用的实时语音陪伴网页。浏览器只上传流式麦克风数据到本机语音 Worker；音频不落盘，最终字幕使用 AES-256-GCM 加密保存30天。

## 产品行为

- 微信内首次打开自动使用公众号 `snsapi_base` 授权，只取 OpenID 的 HMAC 指纹并生成“树洞旅人”账号。
- 外部浏览器自动创建访客账号，可试用180秒；微信用户每天600秒，北京时间零点重置。
- 三个陪伴角色：晚风（Serena）、微光（Cherry）、守夜（Ethan）。用户看不到供应商、模型或音色英文名。
- 默认链路：Silero VAD → SenseVoice/FunASR → 文本模型 → Qwen3实时TTS。
- 普通倾诉使用便宜模型，复杂/专业问题及风险内容自动转交强模型。
- 管理员查看对话必须填写原因，解密查看会写入审计日志。
- 提示词支持草稿、发布和回滚；身份与安全规则不可从后台删除。

## 本地启动

要求 Node.js 20.9+ 与 Python 3.10+。

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

另开终端启动语音 Worker：

```powershell
Set-Location voice-worker
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn voice_worker.main:app --host 127.0.0.1 --port 3503
```

开发环境需要把 `/voice-ws` 反向代理到 `127.0.0.1:3503/ws`。生产 Nginx 与 systemd 片段在 `deploy/`。

管理员入口隐藏为 `/login?admin=1`。普通用户不显示账号密码页面。

## 关键接口

- `GET /api/auth/wechat/start`、`GET /api/auth/wechat/callback`：微信网页授权。
- `POST /api/conversations`：开始会话。
- `POST /api/conversations/:id/messages`：幂等保存最终字幕。
- `DELETE /api/conversations`：用户清空全部记录。
- `POST /api/voice/token`：领取带角色、会话ID和剩余额度的一次性 Worker 令牌。
- `POST /api/internal/voice-usage`：Worker HMAC 签名回传实际连接秒数。
- `POST /api/reply`：风险分类和普通/强模型路由。
- `GET /api/admin/conversations`：管理员查看对话摘要。
- `POST /api/admin/conversations/:id`：填写原因后解密查看。
- `GET/PATCH /api/admin/settings`：额度、VAD和默认角色。
- `GET/POST/PATCH /api/admin/prompts`：提示词版本管理。

## 数据维护

每天运行：

```powershell
npm run maintenance
```

该任务会删除30天前的消息、清理过期 OAuth 状态、释放异常中断的额度预留、创建 SQLite 在线备份，并删除7天前的备份。生产环境应通过 systemd timer 或 cron 每日执行。

## 验证

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
Set-Location voice-worker
python -m pytest -q
```

正式部署前必须轮换所有曾经出现在聊天、截图或历史配置中的微信、千问和第三方模型密钥。不要把 `.env.local`、SQLite、备份、音频或真实密钥提交到 Git。
