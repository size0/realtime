import json
import urllib.request

from voice_worker.runtime_config import RuntimeVoiceConfig, fetch_voice_config


class FakeResponse:
    status = 200

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self, _: int) -> bytes:
        return json.dumps(
            {
                "voiceSettings": {
                    "vadSilenceMs": 1250,
                    "asrProvider": "sensevoice-local",
                    "asrModel": "FunAudioLLM/SenseVoiceSmall",
                    "ttsProvider": "qwen3-realtime",
                    "ttsModel": "qwen3-tts-instruct-flash-realtime",
                }
            }
        ).encode("utf-8")


class InvalidResponse(FakeResponse):
    def read(self, _: int) -> bytes:
        return b"not-json"


def test_fetch_voice_config_accepts_signed_backend_settings(monkeypatch: object) -> None:
    captured: list[urllib.request.Request] = []

    def fake_urlopen(request: urllib.request.Request, timeout: int) -> FakeResponse:
        captured.append(request)
        assert timeout == 5
        return FakeResponse()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    fallback = RuntimeVoiceConfig(1100, "fallback/asr", "fallback-tts")
    result = fetch_voice_config(
        "https://voice.example/api/internal/voice-config",
        "worker-secret-that-is-longer-than-32-characters",
        fallback,
    )
    assert result.vad_silence_ms == 1250
    assert result.asr_model == "FunAudioLLM/SenseVoiceSmall"
    assert result.tts_model == "qwen3-tts-instruct-flash-realtime"
    assert captured[0].headers["X-voice-signature"]


def test_fetch_voice_config_keeps_safe_fallback_on_invalid_payload(
    monkeypatch: object,
) -> None:
    fallback = RuntimeVoiceConfig(1100, "fallback/asr", "fallback-tts")
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: InvalidResponse(),
    )
    assert fetch_voice_config(
        "https://voice.example/api/internal/voice-config",
        "worker-secret-that-is-longer-than-32-characters",
        fallback,
    ) == fallback
