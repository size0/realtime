# 百聆式拆分语音链路任务

- [ ] 1. 定义共享的低成本语音模式、worker 事件、固定 TTS 音色类型。
- [ ] 2. 实现并测试 HMAC worker token 的签发与验证兼容格式。
- [ ] 3. 新增 `POST /api/voice/token`，接入会话、Origin、CSRF、频率与每日额度。
- [ ] 4. 把 `/api/reply` 改为 economy/strong 自动路由并补测试。
- [ ] 5. 新建 Python voice-worker：
  - [ ] FastAPI WebSocket 与健康检查
  - [ ] 令牌、Origin、大小和会话限制
  - [ ] Silero VAD，1100ms 静音封口
  - [ ] SenseVoice/FunASR 本地识别
  - [ ] Qwen3 TTS Realtime 固定 Cherry 音色
  - [ ] 插话取消和安全日志
- [ ] 6. 新增浏览器 PCM AudioWorklet、WebSocket hook、PCM 播放队列与插话清理。
- [ ] 7. 在现有树洞 UI 增加“省钱模式 / 高保真回退”选择，不重做页面。
- [ ] 8. 更新 `.env.example`、README、systemd 和 Nginx 部署说明。
- [ ] 9. 运行 TypeScript、Lint、Vitest、Python 测试和生产构建。
- [ ] 10. 推送 GitHub，部署 worker 与 Next.js，验证生产健康检查和浏览器真实语音。

