from voice_worker.vad import (
    FRAME_BYTES,
    AudioTurnDetector,
    SpeechStarted,
    SpeechStopped,
)


def test_buffers_one_complete_utterance_around_vad_boundaries() -> None:
    frame_index = 0

    def fake_vad(_: bytes):
        nonlocal frame_index
        frame_index += 1
        if frame_index == 3:
            return {"start": 100}
        if frame_index == 18:
            return {"end": 9000}
        return None

    detector = AudioTurnDetector(fake_vad)
    events = detector.feed(b"\0" * FRAME_BYTES * 18)
    assert isinstance(events[0], SpeechStarted)
    assert isinstance(events[1], SpeechStopped)
    assert len(events[1].audio) >= FRAME_BYTES * 16


def test_rejects_too_short_false_positive_utterance() -> None:
    frame_index = 0

    def fake_vad(_: bytes):
        nonlocal frame_index
        frame_index += 1
        if frame_index == 1:
            return {"start": 0}
        if frame_index == 2:
            return {"end": 512}
        return None

    detector = AudioTurnDetector(fake_vad)
    events = detector.feed(b"\0" * FRAME_BYTES * 2)
    assert len(events) == 1
    assert isinstance(events[0], SpeechStarted)

