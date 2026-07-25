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
                    "vadThreshold": 0.62,
                    "speechPadMs": 220,
                    "asrProvider": "sensevoice-local",
                    "asrModel": "FunAudioLLM/SenseVoiceSmall",
                    "ttsProvider": "qwen3-realtime",
                    "ttsModel": "qwen3-tts-instruct-flash-realtime",
                    "ttsWsUrl": "wss://tts.example/ws",
                    "dashscopeApiKey": "dynamic-secret",
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
    fallback = RuntimeVoiceConfig(
        1100,
        "fallback/asr",
        "fallback-tts",
        dashscope_api_key="environment-secret",
        tts_ws_url="wss://environment.example/ws",
        vad_threshold=0.5,
        speech_pad_ms=160,
    )
    result = fetch_voice_config(
        "https://voice.example/api/internal/voice-config",
        "worker-secret-that-is-longer-than-32-characters",
        fallback,
    )
    assert result.vad_silence_ms == 1250
    assert result.vad_threshold == 0.62
    assert result.speech_pad_ms == 220
    assert result.asr_model == "FunAudioLLM/SenseVoiceSmall"
    assert result.tts_model == "qwen3-tts-instruct-flash-realtime"
    assert result.tts_ws_url == "wss://tts.example/ws"
    assert result.dashscope_api_key == "dynamic-secret"
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


def test_fetch_voice_config_keeps_environment_values_for_legacy_response(
    monkeypatch: object,
) -> None:
    class LegacyResponse(FakeResponse):
        def read(self, _: int) -> bytes:
            return json.dumps(
                {
                    "voiceSettings": {
                        "vadSilenceMs": 900,
                        "asrProvider": "sensevoice-local",
                        "asrModel": "FunAudioLLM/SenseVoiceSmall",
                        "ttsProvider": "qwen3-realtime",
                        "ttsModel": "qwen3-tts-instruct-flash-realtime",
                    }
                }
            ).encode("utf-8")

    fallback = RuntimeVoiceConfig(
        1100,
        "fallback/asr",
        "fallback-tts",
        dashscope_api_key="environment-secret",
        tts_ws_url="wss://environment.example/ws",
        vad_threshold=0.5,
        speech_pad_ms=160,
    )
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: LegacyResponse(),
    )

    result = fetch_voice_config(
        "https://voice.example/api/internal/voice-config",
        "worker-secret-that-is-longer-than-32-characters",
        fallback,
    )

    assert result.dashscope_api_key == "environment-secret"
    assert result.tts_ws_url == "wss://environment.example/ws"
    assert result.vad_threshold == 0.5
    assert result.speech_pad_ms == 160


def test_fetch_voice_config_rejects_unsafe_tts_websocket_url(
    monkeypatch: object,
) -> None:
    class UnsafeResponse(FakeResponse):
        def read(self, _: int) -> bytes:
            payload = json.loads(super().read(16 * 1024))
            payload["voiceSettings"]["ttsWsUrl"] = "file:///etc/passwd"
            return json.dumps(payload).encode("utf-8")

    fallback = RuntimeVoiceConfig(
        1100,
        "fallback/asr",
        "fallback-tts",
        dashscope_api_key="environment-secret",
        tts_ws_url="wss://environment.example/ws",
    )
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: UnsafeResponse(),
    )

    assert fetch_voice_config(
        "https://voice.example/api/internal/voice-config",
        "worker-secret-that-is-longer-than-32-characters",
        fallback,
    ) == fallback
