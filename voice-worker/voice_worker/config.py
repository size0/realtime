from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class Settings:
    app_origin: str
    worker_secret: str
    asr_model: str = "iic/SenseVoiceSmall"
    tts_model: str = "qwen3-tts-instruct-flash-realtime"
    tts_voice: str = "Cherry"
    tts_ws_url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    dashscope_api_key: str = ""
    vad_threshold: float = 0.5
    min_silence_duration_ms: int = 1100
    speech_pad_ms: int = 160
    max_audio_chunk_bytes: int = 64 * 1024
    max_session_seconds: int = 30 * 60
    max_tts_text_chars: int = 600

    @classmethod
    def from_env(cls) -> "Settings":
        app_origin = os.environ.get("APP_ORIGIN", "").strip().rstrip("/")
        parsed = urlparse(app_origin)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("APP_ORIGIN must be an absolute HTTP(S) origin.")

        worker_secret = (
            os.environ.get("VOICE_WORKER_SECRET", "").strip()
            or os.environ.get("SESSION_SECRET", "").strip()
        )
        if len(worker_secret) < 32:
            raise ValueError(
                "VOICE_WORKER_SECRET or SESSION_SECRET must contain at least 32 characters."
            )

        threshold = _float_env("VOICE_VAD_THRESHOLD", 0.5, 0.1, 0.95)
        min_silence = _int_env("VOICE_MIN_SILENCE_MS", 1100, 500, 3000)
        speech_pad = _int_env("VOICE_SPEECH_PAD_MS", 160, 0, 1000)

        return cls(
            app_origin=app_origin,
            worker_secret=worker_secret,
            asr_model=os.environ.get("VOICE_ASR_MODEL", "iic/SenseVoiceSmall").strip(),
            tts_model=os.environ.get(
                "VOICE_TTS_MODEL", "qwen3-tts-instruct-flash-realtime"
            ).strip(),
            tts_voice=os.environ.get("VOICE_TTS_VOICE", "Cherry").strip(),
            tts_ws_url=os.environ.get(
                "VOICE_TTS_WS_URL",
                "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
            ).strip(),
            dashscope_api_key=os.environ.get("DASHSCOPE_API_KEY", "").strip(),
            vad_threshold=threshold,
            min_silence_duration_ms=min_silence,
            speech_pad_ms=speech_pad,
        )


def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer.") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} is outside the supported range.")
    return value


def _float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number.") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} is outside the supported range.")
    return value

