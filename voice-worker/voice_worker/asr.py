from __future__ import annotations

import re
from typing import Any

SENSEVOICE_TAG = re.compile(r"<\|[^|>]+\|>")


class SenseVoiceAsr:
    def __init__(self, model_name: str) -> None:
        from funasr import AutoModel

        self._model: Any = AutoModel(
            model=model_name,
            device="cpu",
            disable_update=True,
            hub="ms",
        )

    def transcribe(self, pcm_s16le: bytes) -> str:
        import numpy as np

        samples = np.frombuffer(pcm_s16le, dtype="<i2").astype("float32") / 32768.0
        result = self._model.generate(
            input=samples,
            cache={},
            language="auto",
            use_itn=True,
            batch_size_s=60,
            merge_vad=False,
        )
        if not result or not isinstance(result[0], dict):
            return ""
        raw_text = result[0].get("text")
        if not isinstance(raw_text, str):
            return ""
        try:
            from funasr.utils.postprocess_utils import rich_transcription_postprocess

            text = rich_transcription_postprocess(raw_text)
        except (ImportError, AttributeError, TypeError, ValueError):
            text = SENSEVOICE_TAG.sub("", raw_text)
        return " ".join(text.split()).strip()
