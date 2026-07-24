"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  CaptionsOff,
  History,
  Leaf,
  LockKeyhole,
  Mic,
  MicOff,
  MoonStar,
  PhoneOff,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useSplitVoice } from "@/hooks/use-split-voice";
import type { PublicUser } from "@/lib/auth-store";
import {
  COMPANION_OPTIONS,
  isCompanionVoice,
  type CompanionVoice,
} from "@/types/product";
import type { CallStatus } from "@/types/realtime";

const COMPANION_STORAGE_KEY = "treehole.companion.v1";

const STATUS_COPY: Record<CallStatus, { title: string; detail: string }> = {
  idle: { title: "今晚，想说点什么？", detail: "这里没有评判，也不用组织好语言。" },
  "requesting-permission": {
    title: "等待麦克风",
    detail: "请允许浏览器使用麦克风，音频不会被保存。",
  },
  connecting: { title: "正在靠近", detail: "给彼此一点点时间，声音马上就到。" },
  listening: { title: "我在听", detail: "慢慢说，停下来之后我再回应你。" },
  thinking: { title: "让我想一想", detail: "你随时可以继续补充，不用等我。" },
  speaking: { title: "正在回应", detail: "想说话就直接开口，我会停下来听你。" },
  muted: { title: "麦克风已静音", detail: "准备好以后，再打开麦克风就好。" },
  disconnected: { title: "这段对话结束了", detail: "谢谢你愿意在这里说一说。" },
  error: { title: "刚刚没能连上", detail: "检查提示后，可以重新试一次。" },
};

const ROLE_ICON = {
  breeze: Leaf,
  glow: Sparkles,
  nightwatch: MoonStar,
} satisfies Record<CompanionVoice, typeof Leaf>;

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type OrbStyle = CSSProperties & { "--audio-level": number };

interface VoiceConsoleProps {
  user: PublicUser;
  csrfToken: string;
  defaultCompanion: CompanionVoice;
}

export function VoiceConsole({
  user,
  csrfToken,
  defaultCompanion,
}: VoiceConsoleProps) {
  const [showCaptions, setShowCaptions] = useState(true);
  const [selectedCompanion, setSelectedCompanion] =
    useState<CompanionVoice>(defaultCompanion);
  const [showWechatTip, setShowWechatTip] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const voice = useSplitVoice(selectedCompanion, csrfToken);
  const {
    callStatus,
    messages,
    errorMessage,
    isMuted,
    isActive,
    audioLevel,
    remainingSeconds,
    connect,
    endCall,
    toggleMute,
    clearTranscript,
  } = voice;

  const companion = useMemo(
    () =>
      COMPANION_OPTIONS.find((option) => option.value === selectedCompanion) ??
      COMPANION_OPTIONS[0],
    [selectedCompanion],
  );
  const status = STATUS_COPY[callStatus];
  const quotaEnded = remainingSeconds === 0;

  useEffect(() => {
    const stored = window.localStorage.getItem(COMPANION_STORAGE_KEY);
    if (!isCompanionVoice(stored)) return;
    const frame = window.requestAnimationFrame(() => setSelectedCompanion(stored));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COMPANION_STORAGE_KEY, selectedCompanion);
  }, [selectedCompanion]);

  useEffect(() => {
    if (showCaptions && messages.length > 0) {
      transcriptEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [messages, showCaptions]);

  const chooseCompanion = (value: CompanionVoice) => {
    if (!isActive) setSelectedCompanion(value);
  };

  return (
    <main className="treehole-shell">
      <div className="treehole-night" aria-hidden="true" />
      <div className="treehole-grain" aria-hidden="true" />

      <header className="treehole-topbar">
        <a className="treehole-brand" href="#voice-stage" aria-label="回到语音对话">
          <span className="treehole-brand-mark"><MoonStar size={17} /></span>
          <span>树洞</span>
          <small>听你慢慢说</small>
        </a>
        <div className="treehole-account">
          <span className="treehole-privacy">
            <LockKeyhole size={13} />
            文字加密保存30天 · 不保存音频
          </span>
          <span className="treehole-user">{user.displayName}</span>
          {user.role === "admin" && (
            <Link href="/admin" className="treehole-icon-link" aria-label="管理后台">
              <Settings size={16} />
            </Link>
          )}
        </div>
      </header>

      <section className="treehole-layout" id="voice-stage">
        <section className="treehole-stage" aria-labelledby="voice-status-title">
          <div className="treehole-stage-copy">
            <span className="treehole-kicker">A QUIET PLACE FOR YOU</span>
            <h1 id="voice-status-title">{errorMessage ? "再试一次也没关系" : status.title}</h1>
            <p>{errorMessage ?? status.detail}</p>
          </div>

          <div className={`treehole-orb-wrap status-${callStatus}`}>
            <span className="treehole-orbit orbit-a" aria-hidden="true" />
            <span className="treehole-orbit orbit-b" aria-hidden="true" />
            <div
              className="treehole-orb"
              style={{ "--audio-level": audioLevel } as OrbStyle}
              aria-hidden="true"
            >
              <span className="treehole-orb-glow" />
              <span className="treehole-orb-core">
                {callStatus === "speaking" ? <Sparkles size={34} /> : <Leaf size={34} />}
              </span>
            </div>
            <div className="treehole-live-state">
              <span className={isActive ? "is-live" : ""} />
              {isActive ? companion.name : companion.greeting}
            </div>
          </div>

          {isActive && (
            <div className="treehole-time" aria-live="polite">
              <span>剩余时间</span>
              <strong>{formatDuration(remainingSeconds ?? 0)}</strong>
            </div>
          )}

          {!isActive && !quotaEnded && (
            <div className="treehole-start-panel">
              <div className="treehole-role-heading">
                <span>今晚谁来陪你</span>
                <small>下次会记住你的选择</small>
              </div>
              <div className="treehole-roles" role="radiogroup" aria-label="选择陪伴角色">
                {COMPANION_OPTIONS.map((option) => {
                  const Icon = ROLE_ICON[option.value];
                  const selected = option.value === selectedCompanion;
                  return (
                    <button
                      className={`treehole-role ${selected ? "is-selected" : ""}`}
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => chooseCompanion(option.value)}
                    >
                      <span className="treehole-role-icon"><Icon size={18} /></span>
                      <strong>{option.name}</strong>
                      <small>{option.description}</small>
                    </button>
                  );
                })}
              </div>
              <button
                className="treehole-start"
                type="button"
                onClick={() => void connect()}
              >
                {callStatus === "error" ? <RotateCcw size={19} /> : <Mic size={19} />}
                <span>{callStatus === "error" ? "重新试试" : "开始聊聊"}</span>
              </button>
              <p className="treehole-mic-note">首次开始时，浏览器会询问麦克风权限</p>
            </div>
          )}

          {isActive && (
            <div className="treehole-controls" aria-label="通话控制">
              <button
                className={isMuted ? "is-active" : ""}
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? "取消静音" : "静音"}
                aria-pressed={isMuted}
              >
                {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
                <span>{isMuted ? "打开麦克风" : "静音"}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCaptions((value) => !value)}
                aria-label={showCaptions ? "隐藏字幕" : "显示字幕"}
                aria-pressed={showCaptions}
              >
                {showCaptions ? <Captions size={22} /> : <CaptionsOff size={22} />}
                <span>字幕</span>
              </button>
              <button
                className="is-end"
                type="button"
                onClick={endCall}
                aria-label="结束通话"
              >
                <PhoneOff size={22} />
                <span>结束</span>
              </button>
            </div>
          )}

          {user.accountType === "guest" && (quotaEnded || !isActive) && (
            <div className={`treehole-wechat ${quotaEnded ? "is-prominent" : ""}`}>
              <div>
                <strong>{quotaEnded ? "体验时间用完了" : "访客可先体验 3 分钟"}</strong>
                <span>在微信内打开后，每天可以继续聊 10 分钟。</span>
              </div>
              <button type="button" onClick={() => setShowWechatTip((value) => !value)}>
                在微信里继续聊
              </button>
              {showWechatTip && (
                <p>请在微信中打开 <b>voice.xdw0.cn</b>，会自动生成你的匿名树洞账号。</p>
              )}
            </div>
          )}
        </section>

        <aside className={`treehole-transcript ${showCaptions ? "" : "is-hidden"}`}>
          <header>
            <div>
              <span>只属于这段夜晚</span>
              <h2><History size={18} /> 对话记录</h2>
            </div>
            <div>
              <button
                type="button"
                onClick={() => setShowCaptions((value) => !value)}
                aria-label={showCaptions ? "隐藏字幕" : "显示字幕"}
              >
                {showCaptions ? <Captions size={17} /> : <CaptionsOff size={17} />}
              </button>
              <button
                type="button"
                onClick={clearTranscript}
                disabled={messages.length === 0}
                aria-label="清空所有对话记录"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </header>

          <div className="treehole-messages" aria-live="polite">
            {!showCaptions ? (
              <div className="treehole-empty">
                <CaptionsOff size={25} />
                <p>字幕已经藏起来了</p>
                <span>语音仍会正常播放</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="treehole-empty">
                <MoonStar size={26} />
                <p>说出口的话，会轻轻落在这里</p>
                <span>你可以随时清空记录</span>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={`treehole-message role-${message.role}`}
                  key={message.id}
                  data-status={message.status}
                >
                  <span>{message.role === "user" ? "你" : companion.name}</span>
                  <p>{message.text}</p>
                  {message.status === "interrupted" && <small>被你打断</small>}
                </article>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
          <footer>
            <span>{messages.length} / 200</span>
            <span>30天后自动清理</span>
          </footer>
        </aside>
      </section>
    </main>
  );
}
