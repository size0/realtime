from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlparse

from .config import Settings
from .usage import signed_usage_headers

MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$")


@dataclass(frozen=True)
class RuntimeVoiceConfig:
    vad_silence_ms: int
    asr_model: str
    tts_model: str
    dashscope_api_key: str = ""
    tts_ws_url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    vad_threshold: float = 0.5
    speech_pad_ms: int = 160

    @classmethod
    def from_settings(cls, settings: Settings) -> "RuntimeVoiceConfig":
        return cls(
            vad_silence_ms=settings.min_silence_duration_ms,
            asr_model=settings.asr_model,
            tts_model=settings.tts_model,
            dashscope_api_key=settings.dashscope_api_key,
            tts_ws_url=settings.tts_ws_url,
            vad_threshold=settings.vad_threshold,
            speech_pad_ms=settings.speech_pad_ms,
        )


def _number_in_range(value: object, fallback: float, minimum: float, maximum: float) -> float:
    if isinstance(value, (int, float)) and minimum <= float(value) <= maximum:
        return float(value)
    return fallback


def _integer_in_range(value: object, fallback: int, minimum: int, maximum: int) -> int:
    if isinstance(value, int) and minimum <= value <= maximum:
        return value
    return fallback


def _safe_ws_url(value: object, fallback: str) -> str:
    if not isinstance(value, str):
        return fallback
    parsed = urlparse(value)
    if parsed.scheme in {"ws", "wss"} and parsed.netloc:
        return value
    return fallback


def _is_safe_ws_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"ws", "wss"} and bool(parsed.netloc)


def fetch_voice_config(
    url: str,
    secret: str,
    fallback: RuntimeVoiceConfig,
) -> RuntimeVoiceConfig:
    timestamp_ms = int(time.time() * 1000)
    headers = signed_usage_headers(
        b"",
        secret,
        timestamp_ms,
        method="GET",
        path=urlparse(url).path or "/api/internal/voice-config",
    )
    try:
        request = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status != 200:
                return fallback
            payload = json.loads(response.read(16 * 1024).decode("utf-8"))
    except (
        json.JSONDecodeError,
        UnicodeDecodeError,
        urllib.error.URLError,
        TimeoutError,
        ValueError,
    ):
        return fallback

    if not isinstance(payload, dict):
        return fallback
    settings = payload.get("voiceSettings")
    if not isinstance(settings, dict):
        return fallback
    vad_silence_ms = settings.get("vadSilenceMs")
    asr_provider = settings.get("asrProvider")
    asr_model = settings.get("asrModel")
    tts_provider = settings.get("ttsProvider")
    tts_model = settings.get("ttsModel")
    tts_ws_url_value = settings.get("ttsWsUrl")
    if isinstance(tts_ws_url_value, str) and not _is_safe_ws_url(tts_ws_url_value):
        return fallback
    tts_ws_url = _safe_ws_url(tts_ws_url_value, fallback.tts_ws_url)
    dashscope_api_key = settings.get("dashscopeApiKey")
    if (
        not isinstance(vad_silence_ms, int)
        or not 500 <= vad_silence_ms <= 3000
        or asr_provider != "sensevoice-local"
        or not isinstance(asr_model, str)
        or not MODEL_PATTERN.fullmatch(asr_model)
        or tts_provider != "qwen3-realtime"
        or not isinstance(tts_model, str)
        or not MODEL_PATTERN.fullmatch(tts_model)
    ):
        return fallback
    return RuntimeVoiceConfig(
        vad_silence_ms=vad_silence_ms,
        asr_model=asr_model,
        tts_model=tts_model,
        dashscope_api_key=(
            dashscope_api_key if isinstance(dashscope_api_key, str) else fallback.dashscope_api_key
        ),
        tts_ws_url=tts_ws_url,
        vad_threshold=_number_in_range(
            settings.get("vadThreshold"), fallback.vad_threshold, 0.1, 0.95
        ),
        speech_pad_ms=_integer_in_range(
            settings.get("speechPadMs"), fallback.speech_pad_ms, 0, 1000
        ),
    )
