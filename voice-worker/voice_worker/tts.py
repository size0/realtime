from __future__ import annotations

import asyncio
import base64
import json
import threading
from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class TtsRequest:
    response_id: str
    segment_id: str
    text: str


@dataclass(frozen=True)
class TtsOutput:
    kind: Literal["audio", "done", "error"]
    generation: int
    request: TtsRequest
    audio: bytes = b""


class QwenRealtimeTtsProvider:
    def __init__(
        self,
        api_key: str,
        model: str,
        voice: str,
        websocket_url: str,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        if not api_key:
            raise ValueError("DASHSCOPE_API_KEY is required for TTS.")
        self._api_key = api_key
        self._model = model
        self._voice = voice
        self._websocket_url = websocket_url
        self._loop = loop
        self._queue: asyncio.Queue[TtsOutput] = asyncio.Queue(maxsize=256)
        self._client: Any | None = None
        self._generation = 0
        self._active: TtsRequest | None = None
        self._busy = False
        self._state_lock = threading.Lock()

    async def synthesize(self, request: TtsRequest) -> int:
        with self._state_lock:
            if self._busy:
                raise RuntimeError("TTS is already generating audio.")
            self._busy = True
            self._active = request
            generation = self._generation

        try:
            if self._client is None:
                await asyncio.to_thread(self._connect)
            await asyncio.to_thread(self._append_and_commit, request.text)
            return generation
        except Exception:
            with self._state_lock:
                self._busy = False
                self._active = None
            raise

    async def next_output(self) -> TtsOutput:
        while True:
            output = await self._queue.get()
            if output.generation == self._generation:
                return output

    async def cancel(self) -> None:
        with self._state_lock:
            self._generation += 1
            self._active = None
            self._busy = False
            client = self._client
            self._client = None
        if client is not None:
            await asyncio.to_thread(_close_client, client)
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def close(self) -> None:
        await self.cancel()

    def _connect(self) -> None:
        import dashscope
        from dashscope.audio.qwen_tts_realtime import (
            AudioFormat,
            QwenTtsRealtime,
            QwenTtsRealtimeCallback,
        )

        provider = self

        class Callback(QwenTtsRealtimeCallback):
            def on_event(self, response: Any) -> None:
                provider._on_event(response)

            def on_close(self, close_status_code: Any, close_msg: Any) -> None:
                provider._on_close()

        dashscope.api_key = self._api_key
        client = QwenTtsRealtime(
            model=self._model,
            callback=Callback(),
            url=self._websocket_url,
        )
        client.connect()
        client.update_session(
            voice=self._voice,
            response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
            mode="commit",
            language_type="Auto",
            instructions="温柔、自然、克制，像深夜里认真陪伴的朋友。语速稍慢，有呼吸感，避免客服播报腔。",
            optimize_instructions=True,
        )
        self._client = client

    def _append_and_commit(self, text: str) -> None:
        client = self._client
        if client is None:
            raise RuntimeError("TTS connection is not ready.")
        client.append_text(text)
        client.commit()

    def _on_event(self, response: Any) -> None:
        if isinstance(response, str):
            try:
                response = json.loads(response)
            except json.JSONDecodeError:
                return
        if not isinstance(response, dict):
            return
        event_type = response.get("type")
        with self._state_lock:
            request = self._active
            generation = self._generation
        if request is None:
            return

        if event_type == "response.audio.delta":
            delta = response.get("delta")
            if not isinstance(delta, str):
                return
            try:
                audio = base64.b64decode(delta, validate=True)
            except ValueError:
                return
            self._enqueue(TtsOutput("audio", generation, request, audio))
        elif event_type == "response.done":
            self._enqueue(TtsOutput("done", generation, request))
            with self._state_lock:
                if self._active == request:
                    self._active = None
                    self._busy = False
        elif event_type == "error":
            self._enqueue(TtsOutput("error", generation, request))
            with self._state_lock:
                if self._active == request:
                    self._active = None
                    self._busy = False

    def _on_close(self) -> None:
        with self._state_lock:
            request = self._active
            generation = self._generation
            self._client = None
            self._active = None
            self._busy = False
        if request is not None:
            self._enqueue(TtsOutput("error", generation, request))

    def _enqueue(self, output: TtsOutput) -> None:
        def put() -> None:
            try:
                self._queue.put_nowait(output)
            except asyncio.QueueFull:
                pass

        self._loop.call_soon_threadsafe(put)


def _close_client(client: Any) -> None:
    try:
        client.close()
    except Exception:
        pass

