"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { mapApiError, mapBrowserError } from "@/lib/client-errors";
import { createQwenSessionUpdate } from "@/lib/qwen-session";
import {
  initialRealtimeState,
  isDuplicateRealtimeEvent,
  parseRealtimeEvent,
  realtimeReducer,
} from "@/lib/realtime-events";
import {
  clearTranscript as clearStoredTranscript,
  loadTranscript,
  saveTranscript,
} from "@/lib/transcript-storage";
import type { CallStatus, RealtimeVoice } from "@/types/realtime";

const CONNECTION_TIMEOUT_MS = 20_000;
const ICE_GATHERING_TIMEOUT_MS = 10_000;
const DISCONNECTED_GRACE_MS = 3_000;

interface ApiErrorPayload {
  error?: { code?: string; message?: string };
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as Record<string, unknown>).error;
  if (error === undefined) return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return (
    (candidate.code === undefined || typeof candidate.code === "string") &&
    (candidate.message === undefined || typeof candidate.message === "string")
  );
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isApiErrorPayload(payload)) {
      return mapApiError(payload.error?.code, payload.error?.message);
    }
  } catch {
    return mapApiError(undefined);
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

function waitForIceGatheringComplete(peerConnection: RTCPeerConnection): Promise<void> {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new DOMException("ICE gathering timed out", "AbortError"));
    }, ICE_GATHERING_TIMEOUT_MS);

    const handleStateChange = () => {
      if (peerConnection.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      peerConnection.removeEventListener("icegatheringstatechange", handleStateChange);
    };

    peerConnection.addEventListener("icegatheringstatechange", handleStateChange);
  });
}

export function useRealtimeVoice(voice: RealtimeVoice) {
  const [state, dispatch] = useReducer(realtimeReducer, initialRealtimeState);
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelsRef = useRef(new Set<RTCDataChannel>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<AnalyserNode[]>([]);
  const audioSourcesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const meterFrameRef = useRef<number | null>(null);
  const lastMeterUpdateRef = useRef(0);
  const connectionAttemptRef = useRef(0);
  const seenEventIdsRef = useRef(new Set<string>());
  const hydratedRef = useRef(false);
  const callStartedAtRef = useRef<number | null>(null);
  const sessionConfiguredRef = useRef(false);
  const mutedRef = useRef(false);
  const disconnectedTimerRef = useRef<number | null>(null);

  const stopMeter = useCallback(() => {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    analysersRef.current = [];
    audioSourcesRef.current = [];
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    setAudioLevel(0);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const AudioContextConstructor = window.AudioContext;
    const context = audioContextRef.current ?? new AudioContextConstructor();
    audioContextRef.current = context;

    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    analysersRef.current.push(analyser);
    audioSourcesRef.current.push(source);

    if (meterFrameRef.current !== null) return;

    const sample = (timestamp: number) => {
      let maxLevel = 0;
      for (const activeAnalyser of analysersRef.current) {
        const buffer = new Uint8Array(activeAnalyser.fftSize);
        activeAnalyser.getByteTimeDomainData(buffer);
        let sumSquares = 0;
        for (const sampleValue of buffer) {
          const normalized = (sampleValue - 128) / 128;
          sumSquares += normalized * normalized;
        }
        maxLevel = Math.max(maxLevel, Math.min(1, Math.sqrt(sumSquares / buffer.length) * 4.5));
      }

      if (timestamp - lastMeterUpdateRef.current > 48) {
        lastMeterUpdateRef.current = timestamp;
        setAudioLevel(maxLevel);
      }
      meterFrameRef.current = requestAnimationFrame(sample);
    };

    meterFrameRef.current = requestAnimationFrame(sample);
  }, []);

  const disposeResources = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (disconnectedTimerRef.current !== null) {
      window.clearTimeout(disconnectedTimerRef.current);
      disconnectedTimerRef.current = null;
    }

    for (const channel of dataChannelsRef.current) channel.close();
    dataChannelsRef.current.clear();

    peerConnectionRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }

    stopMeter();
    callStartedAtRef.current = null;
    sessionConfiguredRef.current = false;
    mutedRef.current = false;
    setElapsedSeconds(0);
    setIsMuted(false);
    seenEventIdsRef.current.clear();
  }, [stopMeter]);

  const connect = useCallback(async () => {
    if (!canUseMicrophone()) {
      dispatch({
        type: "set-error",
        message: "浏览器只允许在 HTTPS 或 localhost 中使用麦克风。",
      });
      return;
    }

    disposeResources();
    const attempt = connectionAttemptRef.current + 1;
    connectionAttemptRef.current = attempt;
    dispatch({ type: "set-status", status: "requesting-permission" });

    const failAttempt = (message: string) => {
      if (connectionAttemptRef.current !== attempt) return;
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
      startMeter(stream);
      dispatch({ type: "set-status", status: "connecting" });

      const peerConnection = new RTCPeerConnection({ iceServers: [] });
      peerConnectionRef.current = peerConnection;

      for (const track of stream.getAudioTracks()) {
        track.enabled = false;
        peerConnection.addTrack(track, stream);
      }

      const remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudioRef.current = remoteAudio;

      peerConnection.ontrack = (event) => {
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        remoteAudio.srcObject = remoteStream;
        startMeter(remoteStream);
        void remoteAudio.play().catch(() => {
          failAttempt("浏览器阻止了语音播放，请点击页面后重新连接。");
        });
      };

      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === "connected") {
          if (disconnectedTimerRef.current !== null) {
            window.clearTimeout(disconnectedTimerRef.current);
            disconnectedTimerRef.current = null;
          }
          return;
        }

        if (peerConnection.connectionState === "disconnected") {
          if (disconnectedTimerRef.current !== null) return;
          disconnectedTimerRef.current = window.setTimeout(() => {
            disconnectedTimerRef.current = null;
            if (peerConnection.connectionState === "disconnected") {
              failAttempt("语音网络连接已中断，请检查网络后重试。");
            }
          }, DISCONNECTED_GRACE_MS);
          return;
        }

        if (peerConnection.connectionState === "failed") {
          failAttempt("语音网络连接失败，请检查网络后重试。");
        }
      };

      const handleMessage = (channel: RTCDataChannel, messageEvent: MessageEvent<string>) => {
        try {
          const raw: unknown = JSON.parse(messageEvent.data);
          const event = parseRealtimeEvent(raw);
          if (!event || isDuplicateRealtimeEvent(event, seenEventIdsRef.current)) return;

          if (event.type === "session.created" && !sessionConfiguredRef.current) {
            channel.send(JSON.stringify(createQwenSessionUpdate(voice)));
            sessionConfiguredRef.current = true;
            localStreamRef.current?.getAudioTracks().forEach((track) => {
              track.enabled = !mutedRef.current;
            });
          }

          if (event.type === "session.updated" && !callStartedAtRef.current) {
            callStartedAtRef.current = Date.now();
          }

          if (event.type === "error") {
            failAttempt(event.error.message ?? "千问实时会话发生错误，请重试。");
            return;
          }

          dispatch({ type: "server-event", event });
        } catch {
          failAttempt("收到无法解析的千问实时事件，请重新连接。");
        }
      };

      const bindDataChannel = (channel: RTCDataChannel) => {
        dataChannelsRef.current.add(channel);
        channel.onmessage = (event: MessageEvent<string>) => handleMessage(channel, event);
        channel.onerror = () => failAttempt("实时事件通道发生错误，请重新连接。");
        channel.onclose = () => dataChannelsRef.current.delete(channel);
      };

      peerConnection.ondatachannel = (event) => bindDataChannel(event.channel);
      bindDataChannel(peerConnection.createDataChannel("oai-events"));

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);
      const offerSdp = peerConnection.localDescription?.sdp;
      if (!offerSdp) throw new Error("浏览器未能生成语音连接信息。");

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`/api/realtime/connect?voice=${encodeURIComponent(voice)}`, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offerSdp,
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
        if (abortControllerRef.current === controller) abortControllerRef.current = null;
      }

      if (!response.ok) throw new Error(await readApiError(response));
      const answerSdp = await response.text();
      await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (error: unknown) {
      if (connectionAttemptRef.current !== attempt) return;
      failAttempt(mapBrowserError(error));
    }
  }, [disposeResources, startMeter, voice]);

  const endCall = useCallback(() => {
    connectionAttemptRef.current += 1;
    disposeResources();
    dispatch({ type: "set-status", status: "disconnected" });
  }, [disposeResources]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted && sessionConfiguredRef.current;
    });
    setIsMuted(nextMuted);
  }, []);

  const clearTranscript = useCallback(() => {
    if (typeof window !== "undefined") clearStoredTranscript(window.localStorage);
    dispatch({ type: "clear-messages" });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    dispatch({ type: "load-messages", messages: loadTranscript(window.localStorage) });
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") return;
    saveTranscript(window.localStorage, state.messages);
  }, [state.messages]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (callStartedAtRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - callStartedAtRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      connectionAttemptRef.current += 1;
      disposeResources();
    };
  }, [disposeResources]);

  const isActive = useMemo(
    () =>
      ["requesting-permission", "connecting", "listening", "thinking", "speaking"].includes(
        state.callStatus,
      ),
    [state.callStatus],
  );

  const displayStatus: CallStatus =
    isMuted && (state.callStatus === "listening" || state.callStatus === "thinking")
      ? "muted"
      : state.callStatus;

  return {
    ...state,
    callStatus: displayStatus,
    isMuted,
    isActive,
    audioLevel,
    elapsedSeconds,
    connect,
    endCall,
    toggleMute,
    clearTranscript,
  };
}
