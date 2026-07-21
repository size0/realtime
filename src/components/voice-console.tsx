"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Captions,
  CaptionsOff,
  LockKeyhole,
  LogOut,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import { useRealtimeVoice } from "@/hooks/use-realtime-voice";
import type { PublicUser } from "@/lib/auth-store";
import type { CallStatus } from "@/types/realtime";

const STATUS_COPY: Record<CallStatus, { title: string; detail: string }> = {
  idle: { title: "准备就绪", detail: "戴上耳机，开启一段自然对话" },
  "requesting-permission": { title: "等待麦克风", detail: "请允许浏览器访问你的麦克风" },
  connecting: { title: "建立声场", detail: "正在连接实时语音服务" },
  listening: { title: "我在听", detail: "直接说话，停顿后我会回应" },
  thinking: { title: "正在理解", detail: "你随时可以继续补充" },
  speaking: { title: "正在回应", detail: "说话即可打断，不必等待" },
  muted: { title: "麦克风已静音", detail: "取消静音后继续对话" },
  disconnected: { title: "通话已结束", detail: "文字记录仍保存在这台浏览器" },
  error: { title: "连接未完成", detail: "检查提示后可以重新尝试" },
};

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type OrbStyle = CSSProperties & { "--audio-level": number };

interface VoiceConsoleProps {
  user: PublicUser;
  csrfToken: string;
}

export function VoiceConsole({ user, csrfToken }: VoiceConsoleProps) {
  const [showCaptions, setShowCaptions] = useState(true);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const {
    callStatus,
    messages,
    errorMessage,
    isMuted,
    isActive,
    audioLevel,
    elapsedSeconds,
    connect,
    endCall,
    toggleMute,
    clearTranscript,
  } = useRealtimeVoice();

  const status = STATUS_COPY[callStatus];

  const logout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }).catch(() => undefined);
    window.location.assign("/login");
  };

  useEffect(() => {
    if (showCaptions && messages.length > 0) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, showCaptions]);

  return (
    <main className="voice-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#main-stage" aria-label="声场首页">
          <span className="brand-mark"><AudioLines size={17} strokeWidth={2.2} /></span>
          <span>声场</span>
          <small>REALTIME</small>
        </a>
        <div className="topbar-actions">
          <div className="privacy-chip">
            <LockKeyhole size={13} />
            <span>仅保存文字 · 本地设备</span>
          </div>
          {user.role === "admin" && (
            <Link className="topbar-action" href="/admin" aria-label="打开管理后台">
              <Settings size={15} />
              <span>后台</span>
            </Link>
          )}
          <span className="account-chip">{user.displayName}</span>
          <button className="topbar-action" type="button" onClick={() => void logout()} aria-label="退出登录">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <section className="experience-grid" id="main-stage">
        <div className="conversation-stage">
          <div className="stage-index" aria-hidden="true">01 / LIVE VOICE</div>
          <div className={`orb-field status-${callStatus}`}>
            <div className="orb-orbit orbit-one" aria-hidden="true" />
            <div className="orb-orbit orbit-two" aria-hidden="true" />
            <div
              className="voice-orb"
              aria-hidden="true"
              style={{ "--audio-level": audioLevel } as OrbStyle}
            >
              <div className="orb-surface" />
              <div className="orb-core"><Radio size={34} strokeWidth={1.4} /></div>
            </div>
            <span className="signal-note signal-note-top" aria-hidden="true">48 kHz</span>
            <span className="signal-note signal-note-bottom" aria-hidden="true">WEBRTC / LIVE</span>
          </div>

          <div className="status-block" aria-live="polite">
            <div className="status-line">
              <span className={`status-dot ${isActive ? "is-live" : ""}`} />
              <span>{status.title}</span>
              {isActive && <time>{formatDuration(elapsedSeconds)}</time>}
            </div>
            <p>{errorMessage ?? status.detail}</p>
          </div>

          {!isActive ? (
            <div className="start-cluster">
              <span className="voice-select-label">固定音色</span>
              <div className="voice-fixed-chip" aria-label="固定音色 Tina">
                <strong>甜甜 Tina</strong>
                <span>温暖甜美 · 固定声线</span>
              </div>
              <button className="start-button" type="button" onClick={() => void connect()}>
                {callStatus === "error" ? <RotateCcw size={19} /> : <Mic size={19} />}
                <span>{callStatus === "error" ? "重新连接" : "开始对话"}</span>
              </button>
              <p className="permission-note">开始后浏览器会请求麦克风权限</p>
            </div>
          ) : (
            <div className="call-controls" aria-label="通话控制">
              <button
                className={`round-control ${isMuted ? "is-active" : ""}`}
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? "取消静音" : "静音麦克风"}
                aria-pressed={isMuted}
              >
                {isMuted ? <MicOff size={21} /> : <Mic size={21} />}
              </button>
              <button
                className="round-control"
                type="button"
                onClick={() => setShowCaptions((visible) => !visible)}
                aria-label={showCaptions ? "隐藏字幕" : "显示字幕"}
                aria-pressed={showCaptions}
              >
                {showCaptions ? <Captions size={22} /> : <CaptionsOff size={22} />}
              </button>
              <button className="round-control end-control" type="button" onClick={endCall} aria-label="结束通话">
                <PhoneOff size={22} />
              </button>
            </div>
          )}
        </div>

        <aside className="transcript-rail" aria-label="实时字幕">
          <div className="rail-header">
            <div>
              <span className="eyebrow">TRANSCRIPT</span>
              <h2>对话记录</h2>
            </div>
            <div className="rail-actions">
              <button
                type="button"
                onClick={() => setShowCaptions((visible) => !visible)}
                aria-label={showCaptions ? "隐藏字幕" : "显示字幕"}
              >
                {showCaptions ? <Captions size={17} /> : <CaptionsOff size={17} />}
              </button>
              <button
                type="button"
                onClick={clearTranscript}
                disabled={messages.length === 0}
                aria-label="清空对话记录"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="transcript-list" aria-live="polite">
            {!showCaptions ? (
              <div className="rail-empty">
                <CaptionsOff size={25} />
                <p>字幕已隐藏</p>
                <span>语音仍会正常播放</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="rail-empty">
                <Captions size={25} />
                <p>对话会出现在这里</p>
                <span>只保存文字，不保存音频</span>
              </div>
            ) : (
              messages.map((message, index) => (
                <article
                  className={`transcript-entry role-${message.role}`}
                  key={message.id}
                  data-status={message.status}
                >
                  <div className="entry-meta">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{message.role === "user" ? "你" : "声场"}</strong>
                    {message.status === "interrupted" && <em>已打断</em>}
                  </div>
                  <p>{message.text}</p>
                </article>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>

          <footer className="rail-footer">
            <span>{messages.length} / 200</span>
            <span>LOCAL STORAGE</span>
          </footer>
        </aside>
      </section>
    </main>
  );
}
