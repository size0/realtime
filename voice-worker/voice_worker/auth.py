from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass

TOKEN_VERSION = 1
TOKEN_TTL_MS = 60_000
MAX_TOKEN_BYTES = 2_048
SUBJECT_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
NONCE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


@dataclass(frozen=True)
class VoiceToken:
    subject: str
    expires_at: int
    nonce: str


def verify_voice_token(
    token: str, secret: str, now_ms: int | None = None
) -> VoiceToken | None:
    now = int(time.time() * 1000) if now_ms is None else now_ms
    if not token or len(token.encode("utf-8")) > MAX_TOKEN_BYTES or "." not in token:
        return None
    encoded, provided_signature = token.rsplit(".", 1)
    expected_signature = _base64url(
        hmac.new(secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(expected_signature, provided_signature):
        return None

    try:
        payload = json.loads(_base64url_decode(encoded).decode("utf-8"))
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("v") != TOKEN_VERSION:
        return None

    subject = payload.get("sub")
    expires_at = payload.get("exp")
    nonce = payload.get("nonce")
    if not isinstance(subject, str) or not SUBJECT_PATTERN.fullmatch(subject):
        return None
    if (
        not isinstance(expires_at, int)
        or isinstance(expires_at, bool)
        or expires_at <= now
        or expires_at > now + TOKEN_TTL_MS + 5_000
    ):
        return None
    if not isinstance(nonce, str) or not NONCE_PATTERN.fullmatch(nonce):
        return None
    return VoiceToken(subject=subject, expires_at=expires_at, nonce=nonce)


class NonceCache:
    def __init__(self) -> None:
        self._entries: dict[str, int] = {}

    def consume(self, token: VoiceToken, now_ms: int | None = None) -> bool:
        now = int(time.time() * 1000) if now_ms is None else now_ms
        self._entries = {
            nonce: expires_at
            for nonce, expires_at in self._entries.items()
            if expires_at > now
        }
        if token.nonce in self._entries:
            return False
        self._entries[token.nonce] = token.expires_at
        return True


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)

