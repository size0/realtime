import json

import pytest

from voice_worker.protocol import ProtocolError, SynthesizeEvent, parse_client_event


def test_accepts_bounded_tts_text() -> None:
    event = parse_client_event(
        json.dumps(
            {
                "type": "synthesize",
                "responseId": "response-1",
                "segmentId": "segment-1",
                "text": "  晚上好。  ",
            },
            ensure_ascii=False,
        )
    )
    assert event == SynthesizeEvent(
        type="synthesize",
        response_id="response-1",
        segment_id="segment-1",
        text="晚上好。",
    )


@pytest.mark.parametrize(
    "raw",
    [
        '{"type":"configure","voice":"Cherry"}',
        '{"type":"synthesize","responseId":"bad id","segmentId":"x","text":"hello"}',
        '{"type":"synthesize","responseId":"r","segmentId":"s","text":""}',
        '{"type":"unknown"}',
        "not-json",
    ],
)
def test_rejects_invalid_client_events(raw: str) -> None:
    with pytest.raises(ProtocolError):
        parse_client_event(raw)
