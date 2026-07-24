"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { mapApiError, mapBrowserError } from "@/lib/client-errors";
import { initialRealtimeState, realtimeReducer } from "@/lib/realtime-events";
import { createReplyHistory } from "@/lib/reply-tool";
import { splitForSpeech } from "@/lib/sentence-stream";
import {
  clearTranscript as clearStoredTranscript,
  loadTranscript,
  saveTranscript,
} from "@/lib/transcript-storage";
import type { CompanionVoice } from "@/types/product";
import type { CallStatus, TranscriptMessage } from "@/types/realtime";
import type {
  SplitVoiceClientEvent,
  SplitVoiceServerEvent,
} from "@/types/split-voice";

const CONNECTION_TIMEOUT_MS = 20_000;
const REPLY_TIMEOUT_MS = 35_000;
const MAX_WEBSOCKET_BUFFERED_BYTES = 256 * 1024;

interface VoiceTokenResponse {
  token: string;
  websocketPath: string;
  expiresAt: number;
  remainingSeconds: number;
}

interface ReplyResponse {
  reply: string;
  model: string;
  tier: "economy" | "strong";
}

interface ActiveSpeechResponse {
  responseId: string;
  text: string;
  segments: string[];
  segmentIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVoiceTokenResponse(value: unknown): value is VoiceTokenResponse {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    typeof value.websocketPath === "string" &&
    value.websocketPath.startsWith("/") &&
    typeof value.expiresAt === "number" &&
    typeof value.remainingSeconds === "number"
  );
}

function isReplyResponse(value: unknown): value is ReplyResponse {
  return (
    isRecord(value) &&
    typeof value.reply === "string" &&
    typeof value.model === "string" &&
    (value.tier === "economy" || value.tier === "strong")
  );
}

function isSplitVoiceServerEvent(value: unknown): value is SplitVoiceServerEvent {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.eventId === "string"
  );
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord(payload.error)) {
      return mapApiError(
        typeof payload.error.code === "string" ? payload.error.code : undefined,
        typeof payload.error.message === "string"
          ? payload.error.message
          : undefined,
      );
    }
  } catch {
    // Fall through to a stable message.
  }
  return mapApiError(undefined);
}

function canUseMicrophone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function websocketUrl(path: string, token: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(path, `${protocol}//${window.location.host}`);
  url.searchParams.set("token", token);
  return url.toString();
}

export function useSplitVoice(voice: CompanionVoice, csrfToken: string) {
  const [state, dispatch] = useReducer(realtimeReducer, initialRealtimeState);
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [replyTier, setReplyTier] = useState<"economy" | "strong" | null>(null);

  const websocketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const captureSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const scheduledSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const playbackCursorRef = useRef(0);
  const playbackDoneTimerRef = useRef<number | null>(null);
  const replyAbortControllerRef = useRef<AbortController | null>(null);
  const replyGenerationRef = useRef(0);
  const connectionAttemptRef = useRef(0);
  const seenEventIdsRef = useRef(new Set<string>());
  const activeSpeechRef = useRef<ActiveSpeechResponse | null>(null);
  const callStartedAtRef = useRef<number | null>(null);
  const quotaSecondsRef = useRef<number | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const mutedRef = useRef(false);
  const messagesRef = useRef(state.messages);

  const sendControl = useCallback((event: SplitVoiceClientEvent) => {
    const socket = websocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }, []);

  const syncMessage = useCallback(
    (message: TranscriptMessage) => {
      const conversationId = conversationIdRef.current;
      if (!conversationId || !message.text.trim()) return;
      void fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ messages: [message] }),
        keepalive: true,
      });
    },
    [csrfToken],
  );

  const updateConversationStatus = useCallback(
    (status: "completed" | "interrupted" | "failed") => {
      const conversationId = conversationIdRef.current;
      conversationIdRef.current = null;
      if (!conversationId) return;
      void fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ status }),
        keepalive: true,
      });
    },
    [csrfToken],
  );

  const stopPlayback = useCallback(() => {
    if (playbackDoneTimerRef.current !== null) {
      window.clearTimeout(playbackDoneTimerRef.current);
      playbackDoneTimerRef.current = null;
    }
    for (const source of scheduledSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    scheduledSourcesRef.current.clear();
    playbackCursorRef.current = audioContextRef.current?.currentTime ?? 0;
  }, []);

  const stopMeter = useCallback(() => {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const startMeter = useCallback((context: AudioContext, stream: MediaStream) => {
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    analyserRef.current = analyser;

    const sample = () => {
      if (!analyserRef.current) return;
      const buffer = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buffer);
      let sumSquares = 0;
      for (const value of buffer) {
        const normalized = (value - 128) / 128;
        sumSquares += normalized * normalized;
      }
      setAudioLevel(Math.min(1, Math.sqrt(sumSquares / buffer.length) * 4.5));
      meterFrameRef.current = requestAnimationFrame(sample);
    };
    meterFrameRef.current = requestAnimationFrame(sample);
  }, []);

  const disposeResources = useCallback(() => {
    replyGenerationRef.current += 1;
    replyAbortControllerRef.current?.abort();
    replyAbortControllerRef.current = null;
    activeSpeechRef.current = null;
    stopPlayback();

    const socket = websocketRef.current;
    websocketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
    }
    socket?.close(1000);

    captureNodeRef.current?.disconnect();
    captureSourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    captureNodeRef.current = null;
    captureSourceRef.current = null;
    silentGainRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    stopMeter();
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    callStartedAtRef.current = null;
    quotaSecondsRef.current = null;
    mutedRef.current = false;
    setIsMuted(false);
    setElapsedSeconds(0);
    setRemainingSeconds(null);
    setReplyTier(null);
    seenEventIdsRef.current.clear();
  }, [stopMeter, stopPlayback]);

  const schedulePcm = useCallback((arrayBuffer: ArrayBuffer) => {
    const context = audioContextRef.current;
    if (!context || arrayBuffer.byteLength < 2) return;
    const samples = new Int16Array(arrayBuffer);
    const floats = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      floats[index] = samples[index] / 32768;
    }
    const buffer = context.createBuffer(1, floats.length, 24_000);
    buffer.copyToChannel(floats, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.025, playbackCursorRef.current);
    source.start(startAt);
    playbackCursorRef.current = startAt + buffer.duration;
    scheduledSourcesRef.current.add(source);
    source.onended = () => scheduledSourcesRef.current.delete(source);
    dispatch({ type: "set-status", status: "speaking" });
  }, []);

  const requestReply = useCallback(
    async (question: string, attempt: number) => {
      replyAbortControllerRef.current?.abort();
      const controller = new AbortController();
      replyAbortControllerRef.current = controller;
      const generation = replyGenerationRef.current + 1;
      replyGenerationRef.current = generation;
      dispatch({ type: "set-status", status: "thinking" });
      const timeoutId = window.setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);

      try {
        const response = await fetch("/api/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            history: createReplyHistory(messagesRef.current),
            conversationId: conversationIdRef.current,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const payload: unknown = await response.json();
        if (!isReplyResponse(payload) || !payload.reply.trim()) {
          throw new Error("没有收到可朗读的回答，请再说一次。");
        }
        if (
          replyGenerationRef.current !== generation ||
          connectionAttemptRef.current !== attempt
        ) {
          return;
        }

        const responseId = `assistant_${crypto.randomUUID()}`;
        const text = payload.reply.trim();
        const segments = splitForSpeech(text);
        if (segments.length === 0) throw new Error("没有收到可朗读的回答。");
        setReplyTier(payload.tier);
        activeSpeechRef.current = {
          responseId,
          text,
          segments,
          segmentIndex: 0,
        };
        dispatch({
          type: "server-event",
          event: { type: "response.text.delta", item_id: responseId, delta: text },
        });
        sendControl({
          type: "synthesize",
          responseId,
          segmentId: `${responseId}_0`,
          text: segments[0],
        });
      } catch (error: unknown) {
        if (controller.signal.aborted || replyGenerationRef.current !== generation) return;
        dispatch({
          type: "set-error",
          message:
            error instanceof Error && error.message
              ? error.message
              : "暂时没有接住这句话，请稍后重试。",
        });
      } finally {
        window.clearTimeout(timeoutId);
        if (replyAbortControllerRef.current === controller) {
          replyAbortControllerRef.current = null;
        }
      }
    },
    [sendControl],
  );

  const connect = useCallback(async () => {
    if (!canUseMicrophone()) {
      dispatch({
        type: "set-error",
        message: "浏览器只允许在 HTTPS 或本机环境中使用麦克风。",
      });
      return;
    }

    disposeResources();
    const attempt = connectionAttemptRef.current + 1;
    connectionAttemptRef.current = attempt;
    dispatch({ type: "set-status", status: "requesting-permission" });

    const failAttempt = (message: string) => {
      if (connectionAttemptRef.current !== attempt) return;
      connectionAttemptRef.current += 1;
      updateConversationStatus("failed");
      disposeResources();
      dispatch({ type: "set-error", message });
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (connectionAttemptRef.current !== attempt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      dispatch({ type: "set-status", status: "connecting" });

      const conversationResponse = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ companionVoice: voice }),
      });
      if (!conversationResponse.ok) {
        throw new Error(await readApiError(conversationResponse));
      }
      const conversationPayload: unknown = await conversationResponse.json();
      if (
        !isRecord(conversationPayload) ||
        !isRecord(conversationPayload.conversation) ||
        typeof conversationPayload.conversation.id !== "string"
      ) {
        throw new Error("无法开始这段对话，请稍后重试。");
      }
      conversationIdRef.current = conversationPayload.conversation.id;

      const tokenResponse = await fetch("/api/voice/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ companionVoice: voice }),
      });
      if (!tokenResponse.ok) throw new Error(await readApiError(tokenResponse));
      const tokenPayload: unknown = await tokenResponse.json();
      if (!isVoiceTokenResponse(tokenPayload)) {
        throw new Error("语音服务返回了无效的连接信息。");
      }
      setRemainingSeconds(tokenPayload.remainingSeconds);

      const context = new AudioContext();
      audioContextRef.current = context;
      await context.audioWorklet.addModule("/pcm-capture.worklet.js");
      const source = context.createMediaStreamSource(stream);
      const captureNode = new AudioWorkletNode(context, "pcm-capture");
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(captureNode);
      captureNode.connect(silentGain);
      silentGain.connect(context.destination);
      captureSourceRef.current = source;
      captureNodeRef.current = captureNode;
      silentGainRef.current = silentGain;
      startMeter(context, stream);

      const socket = new WebSocket(
        websocketUrl(tokenPayload.websocketPath, tokenPayload.token),
      );
      socket.binaryType = "arraybuffer";
      websocketRef.current = socket;
      captureNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (
          socket.readyState === WebSocket.OPEN &&
          !mutedRef.current &&
          socket.bufferedAmount < MAX_WEBSOCKET_BUFFERED_BYTES
        ) {
          socket.send(event.data);
        }
      };

      const openPromise = new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(
          () => reject(new DOMException("Voice connection timed out", "AbortError")),
          CONNECTION_TIMEOUT_MS,
        );
        socket.onopen = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };
        socket.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error("语音服务连接失败，请稍后重试。"));
        };
      });

      socket.onmessage = (messageEvent: MessageEvent<string | ArrayBuffer>) => {
        if (messageEvent.data instanceof ArrayBuffer) {
          schedulePcm(messageEvent.data);
          return;
        }
        try {
          const parsed: unknown = JSON.parse(messageEvent.data);
          if (!isSplitVoiceServerEvent(parsed)) return;
          if (seenEventIdsRef.current.has(parsed.eventId)) return;
          seenEventIdsRef.current.add(parsed.eventId);
          if (seenEventIdsRef.current.size > 256) {
            const oldest = seenEventIdsRef.current.values().next().value;
            if (typeof oldest === "string") seenEventIdsRef.current.delete(oldest);
          }

          switch (parsed.type) {
            case "ready":
              callStartedAtRef.current = Date.now();
              quotaSecondsRef.current = parsed.remainingSeconds;
              setRemainingSeconds(parsed.remainingSeconds);
              dispatch({ type: "server-event", event: { type: "session.updated" } });
              break;
            case "speech_started": {
              const interrupted = activeSpeechRef.current;
              if (interrupted) {
                syncMessage({
                  id: interrupted.responseId,
                  role: "assistant",
                  text: interrupted.text,
                  status: "interrupted",
                  createdAt: Date.now(),
                });
              }
              replyGenerationRef.current += 1;
              replyAbortControllerRef.current?.abort();
              replyAbortControllerRef.current = null;
              activeSpeechRef.current = null;
              stopPlayback();
              dispatch({
                type: "server-event",
                event: { type: "input_audio_buffer.speech_started" },
              });
              break;
            }
            case "speech_stopped":
              dispatch({
                type: "server-event",
                event: { type: "input_audio_buffer.speech_stopped" },
              });
              break;
            case "transcript":
              syncMessage({
                id: parsed.utteranceId,
                role: "user",
                text: parsed.text,
                status: "complete",
                createdAt: Date.now(),
              });
              dispatch({
                type: "server-event",
                event: {
                  type: "conversation.item.input_audio_transcription.completed",
                  item_id: parsed.utteranceId,
                  transcript: parsed.text,
                },
              });
              void requestReply(parsed.text, attempt);
              break;
            case "audio_done": {
              const current = activeSpeechRef.current;
              if (!current || current.responseId !== parsed.responseId) break;
              const nextIndex = current.segmentIndex + 1;
              if (nextIndex < current.segments.length) {
                current.segmentIndex = nextIndex;
                sendControl({
                  type: "synthesize",
                  responseId: current.responseId,
                  segmentId: `${current.responseId}_${nextIndex}`,
                  text: current.segments[nextIndex],
                });
              } else {
                const delayMs = Math.max(
                  0,
                  (playbackCursorRef.current -
                    (audioContextRef.current?.currentTime ?? 0)) *
                    1000,
                );
                playbackDoneTimerRef.current = window.setTimeout(() => {
                  syncMessage({
                    id: current.responseId,
                    role: "assistant",
                    text: current.text,
                    status: "complete",
                    createdAt: Date.now(),
                  });
                  dispatch({
                    type: "server-event",
                    event: {
                      type: "response.text.done",
                      item_id: current.responseId,
                      transcript: current.text,
                    },
                  });
                  dispatch({ type: "set-status", status: "listening" });
                  activeSpeechRef.current = null;
                  playbackDoneTimerRef.current = null;
                }, delayMs);
              }
              break;
            }
            case "quota_warning":
              setRemainingSeconds(parsed.remainingSeconds);
              break;
            case "quota_exhausted":
              connectionAttemptRef.current += 1;
              updateConversationStatus("completed");
              disposeResources();
              setRemainingSeconds(0);
              dispatch({ type: "set-status", status: "disconnected" });
              break;
            case "error":
              if (parsed.code === "ASR_EMPTY" || parsed.code === "INVALID_AUDIO") {
                dispatch({ type: "set-status", status: "listening" });
              } else {
                failAttempt(parsed.message);
              }
              break;
            case "audio_start":
            case "interrupted":
              break;
          }
        } catch {
          failAttempt("语音服务返回了无法解析的事件。");
        }
      };

      socket.onclose = (event) => {
        if (connectionAttemptRef.current === attempt && event.code !== 1000) {
          failAttempt("语音连接已经断开，请稍后重试。");
        }
      };

      await openPromise;
    } catch (error: unknown) {
      if (connectionAttemptRef.current !== attempt) return;
      failAttempt(
        error instanceof Error && error.message
          ? mapBrowserError(error)
          : "语音连接失败，请稍后重试。",
      );
    }
  }, [
    csrfToken,
    disposeResources,
    requestReply,
    schedulePcm,
    sendControl,
    startMeter,
    stopPlayback,
    syncMessage,
    updateConversationStatus,
    voice,
  ]);

  const endCall = useCallback(() => {
    connectionAttemptRef.current += 1;
    updateConversationStatus("completed");
    disposeResources();
    dispatch({ type: "set-status", status: "disconnected" });
  }, [disposeResources, updateConversationStatus]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  }, []);

  const clearTranscript = useCallback(() => {
    if (typeof window !== "undefined") clearStoredTranscript(window.localStorage);
    dispatch({ type: "clear-messages" });
    void fetch("/api/conversations", {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
  }, [csrfToken]);

  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    dispatch({
      type: "load-messages",
      messages: loadTranscript(window.localStorage),
    });
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") return;
    saveTranscript(window.localStorage, state.messages);
  }, [state.messages]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!callStartedAtRef.current) return;
      const elapsed = Math.floor((Date.now() - callStartedAtRef.current) / 1000);
      setElapsedSeconds(elapsed);
      if (quotaSecondsRef.current !== null) {
        setRemainingSeconds(Math.max(0, quotaSecondsRef.current - elapsed));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      connectionAttemptRef.current += 1;
      updateConversationStatus("interrupted");
      disposeResources();
    },
    [disposeResources, updateConversationStatus],
  );

  const isActive = useMemo(
    () =>
      [
        "requesting-permission",
        "connecting",
        "listening",
        "thinking",
        "speaking",
      ].includes(state.callStatus),
    [state.callStatus],
  );

  const displayStatus: CallStatus =
    isMuted &&
    (state.callStatus === "listening" || state.callStatus === "thinking")
      ? "muted"
      : state.callStatus;

  return {
    ...state,
    callStatus: displayStatus,
    isMuted,
    isActive,
    audioLevel,
    elapsedSeconds,
    remainingSeconds,
    replyTier,
    connect,
    endCall,
    toggleMute,
    clearTranscript,
  };
}
