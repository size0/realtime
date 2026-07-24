import base64
import hashlib
import hmac
import json

from voice_worker.auth import NonceCache, verify_voice_token

SECRET = "voice-worker-secret-with-at-least-32-characters"


def token(payload: dict[str, object]) -> str:
    encoded = (
        base64.urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":")).encode("utf-8")
        )
        .decode("ascii")
        .rstrip("=")
    )
    signature = (
        base64.urlsafe_b64encode(
            hmac.new(
                SECRET.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256
            ).digest()
        )
        .decode("ascii")
        .rstrip("=")
    )
    return f"{encoded}.{signature}"


def test_accepts_node_compatible_token_and_rejects_replay() -> None:
    raw = token(
        {
            "v": 2,
            "sub": "user-123",
            "sid": "voice-session-123",
            "voice": "breeze",
            "quota": 180,
            "exp": 1_700_000_060_000,
            "nonce": "abcdefghijklmnopqrstuvwx",
        }
    )
    verified = verify_voice_token(raw, SECRET, 1_700_000_000_000)
    assert verified is not None
    assert verified.subject == "user-123"
    assert verified.session_id == "voice-session-123"
    assert verified.companion_voice == "breeze"
    assert verified.quota_seconds == 180

    cache = NonceCache()
    assert cache.consume(verified, 1_700_000_000_000)
    assert not cache.consume(verified, 1_700_000_000_001)


def test_rejects_tampered_expired_and_oversized_tokens() -> None:
    raw = token(
        {
            "v": 2,
            "sub": "user-123",
            "sid": "voice-session-123",
            "voice": "nightwatch",
            "quota": 600,
            "exp": 1_700_000_060_000,
            "nonce": "abcdefghijklmnopqrstuvwx",
        }
    )
    assert verify_voice_token(raw + "x", SECRET, 1_700_000_000_000) is None
    assert verify_voice_token(raw, SECRET, 1_700_000_060_000) is None
    assert verify_voice_token("x" * 3000, SECRET, 1_700_000_000_000) is None
