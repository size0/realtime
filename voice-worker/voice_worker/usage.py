from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request


def signed_usage_headers(body: bytes, secret: str, timestamp_ms: int) -> dict[str, str]:
    signature = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp_ms}.".encode("ascii") + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "Content-Type": "application/json",
        "X-Voice-Timestamp": str(timestamp_ms),
        "X-Voice-Signature": signature,
    }


def report_voice_usage(
    url: str,
    secret: str,
    user_id: str,
    session_id: str,
    used_seconds: int,
) -> bool:
    body = json.dumps(
        {
            "userId": user_id,
            "sessionId": session_id,
            "usedSeconds": max(0, int(used_seconds)),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    timestamp_ms = int(time.time() * 1000)
    request = urllib.request.Request(
        url,
        data=body,
        headers=signed_usage_headers(body, secret, timestamp_ms),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False
