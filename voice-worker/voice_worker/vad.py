from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Protocol

FRAME_SAMPLES = 512
FRAME_BYTES = FRAME_SAMPLES * 2
MIN_UTTERANCE_BYTES = int(16_000 * 2 * 0.24)
MAX_UTTERANCE_BYTES = 1_500_000


class VadIterator(Protocol):
    def __call__(self, samples: Any, return_seconds: bool = False) -> dict[str, int] | None:
        ...

    def reset_states(self) -> None:
        ...


@dataclass(frozen=True)
class SpeechStarted:
    pass


@dataclass(frozen=True)
class SpeechStopped:
    audio: bytes


VadEvent = SpeechStarted | SpeechStopped


class SileroVadEngine:
    def __init__(
        self,
        threshold: float,
        min_silence_duration_ms: int,
        speech_pad_ms: int,
    ) -> None:
        from silero_vad import VADIterator as SileroIterator
        from silero_vad import load_silero_vad

        self._torch = __import__("torch")
        self._iterator_class = SileroIterator
        self._model = load_silero_vad(onnx=True)
        self._settings = {
            "threshold": threshold,
            "sampling_rate": 16_000,
            "min_silence_duration_ms": min_silence_duration_ms,
            "speech_pad_ms": speech_pad_ms,
        }

    def create_session(self) -> "AudioTurnDetector":
        iterator = self._iterator_class(self._model, **self._settings)

        def process(frame: bytes) -> dict[str, int] | None:
            import numpy as np

            samples = np.frombuffer(frame, dtype="<i2").astype("float32") / 32768.0
            tensor = self._torch.from_numpy(samples)
            return iterator(tensor, return_seconds=False)

        return AudioTurnDetector(process, iterator.reset_states)


class AudioTurnDetector:
    def __init__(self, process_frame: Any, reset_iterator: Any | None = None) -> None:
        self._process_frame = process_frame
        self._reset_iterator = reset_iterator
        self._pending = bytearray()
        self._pre_roll: deque[bytes] = deque(maxlen=12)
        self._speech = bytearray()
        self._speaking = False

    def feed(self, chunk: bytes) -> list[VadEvent]:
        self._pending.extend(chunk)
        events: list[VadEvent] = []
        while len(self._pending) >= FRAME_BYTES:
            frame = bytes(self._pending[:FRAME_BYTES])
            del self._pending[:FRAME_BYTES]

            if self._speaking:
                self._speech.extend(frame)
            else:
                self._pre_roll.append(frame)

            result = self._process_frame(frame)
            if result and "start" in result and not self._speaking:
                self._speaking = True
                self._speech = bytearray(b"".join(self._pre_roll))
                self._pre_roll.clear()
                events.append(SpeechStarted())

            forced_stop = self._speaking and len(self._speech) >= MAX_UTTERANCE_BYTES
            if self._speaking and ((result and "end" in result) or forced_stop):
                audio = bytes(self._speech)
                self._speech.clear()
                self._speaking = False
                self._pre_roll.clear()
                if len(audio) >= MIN_UTTERANCE_BYTES:
                    events.append(SpeechStopped(audio=audio))
        return events

    def reset(self) -> None:
        self._pending.clear()
        self._pre_roll.clear()
        self._speech.clear()
        self._speaking = False
        if self._reset_iterator:
            self._reset_iterator()

