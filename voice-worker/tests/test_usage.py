import hashlib
import hmac
import json
import urllib.request

from voice_worker.usage import report_voice_usage, signed_usage_headers


def test_usage_signature_matches_node_contract() -> None:
    body = b'{"userId":"user-1","sessionId":"session-1","usedSeconds":23}'
    secret = "voice-worker-secret-with-at-least-32-characters"
    timestamp = 1_700_000_000_000

    headers = signed_usage_headers(
        body,
        secret,
        timestamp,
        method="POST",
        path="/api/internal/voice-usage",
        nonce="nonce-test-123456",
    )

    expected = hmac.new(
        secret.encode("utf-8"),
        (
            f"{timestamp}.nonce-test-123456.POST."
            "/api/internal/voice-usage."
        ).encode("ascii")
        + body,
        hashlib.sha256,
    ).hexdigest()
    assert headers["X-Voice-Timestamp"] == str(timestamp)
    assert headers["X-Voice-Nonce"] == "nonce-test-123456"
    assert headers["X-Voice-Signature"] == expected


def test_report_voice_usage_includes_provider_metering(monkeypatch: object) -> None:
    captured: list[urllib.request.Request] = []

    class Response:
        status = 204

        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *_: object) -> None:
            return None

    def fake_urlopen(request: urllib.request.Request, timeout: int) -> Response:
        assert timeout == 5
        captured.append(request)
        return Response()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    assert report_voice_usage(
        "https://voice.example/api/internal/voice-usage",
        "voice-worker-secret-with-at-least-32-characters",
        "user-1",
        "session-1",
        23,
        asr_seconds=7,
        tts_characters=42,
    )
    payload = json.loads(captured[0].data or b"{}")
    assert payload == {
        "userId": "user-1",
        "sessionId": "session-1",
        "usedSeconds": 23,
        "asrSeconds": 7,
        "ttsCharacters": 42,
    }


def test_report_voice_usage_clamps_negative_metering(monkeypatch: object) -> None:
    captured: list[urllib.request.Request] = []

    class Response:
        status = 200

        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *_: object) -> None:
            return None

    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda request, **_kwargs: captured.append(request) or Response(),
    )

    assert report_voice_usage(
        "https://voice.example/api/internal/voice-usage",
        "voice-worker-secret-with-at-least-32-characters",
        "user-1",
        "session-1",
        -5,
        asr_seconds=-3,
        tts_characters=-9,
    )
    payload = json.loads(captured[0].data or b"{}")
    assert payload["usedSeconds"] == 0
    assert payload["asrSeconds"] == 0
    assert payload["ttsCharacters"] == 0
