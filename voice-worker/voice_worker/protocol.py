from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from typing import Literal

MAX_JSON_BYTES = 8 * 1024
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
@dataclass(frozen=True)
class SynthesizeEvent:
    type: Literal["synthesize"]
    response_id: str
    segment_id: str
    text: str


@dataclass(frozen=True)
class ControlEvent:
    type: Literal["cancel", "stop"]


ClientEvent = SynthesizeEvent | ControlEvent


class ProtocolError(ValueError):
    pass


def parse_client_event(raw: str, max_tts_text_chars: int = 600) -> ClientEvent:
    if len(raw.encode("utf-8")) > MAX_JSON_BYTES:
        raise ProtocolError("控制消息过大。")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProtocolError("控制消息不是有效 JSON。") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("type"), str):
        raise ProtocolError("控制消息缺少类型。")

    event_type = payload["type"]
    if event_type == "synthesize":
        response_id = payload.get("responseId")
        segment_id = payload.get("segmentId")
        text = payload.get("text")
        if (
            not isinstance(response_id, str)
            or not IDENTIFIER_PATTERN.fullmatch(response_id)
            or not isinstance(segment_id, str)
            or not IDENTIFIER_PATTERN.fullmatch(segment_id)
            or not isinstance(text, str)
        ):
            raise ProtocolError("语音合成消息格式无效。")
        normalized_text = text.strip()
        if not normalized_text or len(normalized_text) > max_tts_text_chars:
            raise ProtocolError("语音合成文本为空或过长。")
        return SynthesizeEvent(
            type="synthesize",
            response_id=response_id,
            segment_id=segment_id,
            text=normalized_text,
        )

    if event_type == "cancel":
        return ControlEvent(type="cancel")
    if event_type == "stop":
        return ControlEvent(type="stop")
    raise ProtocolError("不支持该控制消息。")


def server_event(event_type: str, **values: object) -> dict[str, object]:
    return {"type": event_type, "eventId": uuid.uuid4().hex, **values}


def safe_error(
    code: str, message: str, recoverable: bool = True
) -> dict[str, object]:
    return server_event(
        "error", code=code, message=message, recoverable=recoverable
    )
