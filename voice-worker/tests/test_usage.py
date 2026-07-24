import hashlib
import hmac

from voice_worker.usage import signed_usage_headers


def test_usage_signature_matches_node_contract() -> None:
    body = b'{"userId":"user-1","sessionId":"session-1","usedSeconds":23}'
    secret = "voice-worker-secret-with-at-least-32-characters"
    timestamp = 1_700_000_000_000

    headers = signed_usage_headers(body, secret, timestamp)

    expected = hmac.new(
        secret.encode("utf-8"),
        str(timestamp).encode("ascii") + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    assert headers["X-Voice-Timestamp"] == str(timestamp)
    assert headers["X-Voice-Signature"] == expected
