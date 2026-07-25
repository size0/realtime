from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from .config import Settings
from .usage import signed_usage_headers

MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$")


@dataclass(frozen=True)
class RuntimeVoiceConfig:
    vad_silence_ms: int
    asr_model: str
    tts_model: str

    @classmethod
    def from_settings(cls, settings: Settings) -> "RuntimeVoiceConfig":
        return cls(
            vad_silence_ms=settings.min_silence_duration_ms,
            asr_model=settings.asr_model,
            tts_model=settings.tts_model,
        )


def fetch_voice_config(
    url: str,
    secret: str,
    fallback: RuntimeVoiceConfig,
) -> RuntimeVoiceConfig:
    timestamp_ms = int(time.time() * 1000)
    headers = signed_usage_headers(b"", secret, timestamp_ms)
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
    )
