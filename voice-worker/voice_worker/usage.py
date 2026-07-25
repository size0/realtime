from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse


def signed_usage_headers(
    body: bytes,
    secret: str,
    timestamp_ms: int,
    *,
    method: str = "POST",
    path: str = "/api/internal/voice-usage",
    nonce: str | None = None,
) -> dict[str, str]:
    nonce_value = nonce or secrets.token_urlsafe(24)
    signature = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp_ms}.{nonce_value}.{method.upper()}.{path}.".encode("ascii") + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "Content-Type": "application/json",
        "X-Voice-Timestamp": str(timestamp_ms),
        "X-Voice-Nonce": nonce_value,
        "X-Voice-Signature": signature,
    }


def report_voice_usage(
    url: str,
    secret: str,
    user_id: str,
    session_id: str,
    used_seconds: int,
    *,
    asr_seconds: int = 0,
    tts_characters: int = 0,
) -> bool:
    body = json.dumps(
        {
            "userId": user_id,
            "sessionId": session_id,
            "usedSeconds": max(0, int(used_seconds)),
            "asrSeconds": max(0, int(asr_seconds)),
            "ttsCharacters": max(0, int(tts_characters)),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    timestamp_ms = int(time.time() * 1000)
    path = urlparse(url).path or "/api/internal/voice-usage"
    request = urllib.request.Request(
        url,
        data=body,
        headers=signed_usage_headers(body, secret, timestamp_ms, path=path),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False
