from __future__ import annotations

import asyncio
import logging
import math
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from .asr import SenseVoiceAsr
from .auth import NonceCache, VoiceToken, verify_voice_token
from .config import Settings
from .protocol import (
    ControlEvent,
    ProtocolError,
    SynthesizeEvent,
    parse_client_event,
    safe_error,
    server_event,
)
from .tts import QwenRealtimeTtsProvider, TtsRequest
from .usage import report_voice_usage
from .vad import SileroVadEngine, SpeechStarted, SpeechStopped

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("voice-worker")


@dataclass(frozen=True)
class CompanionTts:
    provider_voice: str
    instructions: str


COMPANION_TTS: dict[str, CompanionTts] = {
    "breeze": CompanionTts(
        provider_voice="Serena",
        instructions="语气轻柔、真诚、慢一点，像深夜里安静陪伴的朋友。停顿自然，不要播音腔。",
    ),
    "glow": CompanionTts(
        provider_voice="Cherry",
        instructions="语气自然亲近、稍微明亮，像熟悉的朋友聊天。节奏松弛，不要客服腔。",
    ),
    "nightwatch": CompanionTts(
        provider_voice="Ethan",
        instructions="语气温暖沉稳、克制可靠，速度稍慢。避免说教，给对方留出呼吸感。",
    ),
}


class ModelRegistry:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.vad: SileroVadEngine | None = None
        self.asr: SenseVoiceAsr | None = None
        self.loading = False
        self.error_code: str | None = None

    @property
    def ready(self) -> bool:
        return self.vad is not None and self.asr is not None

    async def load(self) -> None:
        if self.loading or self.ready:
            return
        self.loading = True
        started = time.monotonic()
        try:
            logger.info("event=models_loading")
            vad, asr = await asyncio.gather(
                asyncio.to_thread(
                    SileroVadEngine,
                    self.settings.vad_threshold,
                    self.settings.min_silence_duration_ms,
                    self.settings.speech_pad_ms,
                ),
                asyncio.to_thread(SenseVoiceAsr, self.settings.asr_model),
            )
            self.vad = vad
            self.asr = asr
            logger.info(
                "event=models_ready elapsed_ms=%d",
                int((time.monotonic() - started) * 1000),
            )
        except Exception:
            self.error_code = "MODEL_LOAD_FAILED"
            logger.exception("event=models_failed")
        finally:
            self.loading = False

    def health(self) -> dict[str, Any]:
        return {
            "ready": self.ready,
            "vad": self.vad is not None,
            "asr": self.asr is not None,
            "ttsConfigured": bool(self.settings.dashscope_api_key),
            "loading": self.loading,
            "errorCode": self.error_code,
        }


class VoiceConnection:
    def __init__(
        self,
        websocket: WebSocket,
        registry: ModelRegistry,
        token: VoiceToken,
    ) -> None:
        self.websocket = websocket
        self.registry = registry
        self.settings = registry.settings
        self.token = token
        self.subject = token.subject
        self.session_id = token.session_id
        self.quota_seconds = min(token.quota_seconds, self.settings.max_session_seconds)
        self.send_lock = asyncio.Lock()
        self.asr_tasks: set[asyncio.Task[None]] = set()
        companion = COMPANION_TTS[token.companion_voice]
        self.tts = QwenRealtimeTtsProvider(
            api_key=self.settings.dashscope_api_key,
            model=self.settings.tts_model,
            voice=companion.provider_voice,
            instructions=companion.instructions,
            websocket_url=self.settings.tts_ws_url,
            loop=asyncio.get_running_loop(),
        )
        if registry.vad is None:
            raise RuntimeError("VAD is not ready.")
        self.turn_detector = registry.vad.create_session()

    async def run(self) -> None:
        started = time.monotonic()
        forwarder = asyncio.create_task(self._forward_tts())
        warning = asyncio.create_task(self._quota_warning())
        await self._send_json(
            server_event(
                "ready",
                inputSampleRate=16_000,
                outputSampleRate=24_000,
                remainingSeconds=self.quota_seconds,
            )
        )
        logger.info(
            "event=session_started session=%s voice=%s quota=%d",
            self.session_id,
            self.token.companion_voice,
            self.quota_seconds,
        )
        try:
            async with asyncio.timeout(self.quota_seconds):
                while True:
                    message = await self.websocket.receive()
                    if message.get("type") == "websocket.disconnect":
                        break
                    audio = message.get("bytes")
                    text = message.get("text")
                    if isinstance(audio, bytes):
                        await self._handle_audio(audio)
                    elif isinstance(text, str) and await self._handle_text(text):
                        break
        except TimeoutError:
            await self._send_json(server_event("quota_exhausted", remainingSeconds=0))
        except WebSocketDisconnect:
            pass
        finally:
            warning.cancel()
            forwarder.cancel()
            await asyncio.gather(warning, forwarder, return_exceptions=True)
            await self.tts.close()
            self.turn_detector.reset()
            for task in self.asr_tasks:
                task.cancel()
            if self.asr_tasks:
                await asyncio.gather(*self.asr_tasks, return_exceptions=True)
            used_seconds = min(
                self.quota_seconds,
                max(1, math.ceil(time.monotonic() - started)),
            )
            reported = await asyncio.to_thread(
                report_voice_usage,
                self.settings.usage_report_url,
                self.settings.worker_secret,
                self.subject,
                self.session_id,
                used_seconds,
            )
            logger.info(
                "event=session_finished session=%s used_seconds=%d usage_reported=%s",
                self.session_id,
                used_seconds,
                reported,
            )

    async def _quota_warning(self) -> None:
        if self.quota_seconds > 20:
            await asyncio.sleep(self.quota_seconds - 20)
        await self._send_json(server_event("quota_warning", remainingSeconds=min(20, self.quota_seconds)))

    async def _handle_audio(self, audio: bytes) -> None:
        if (
            not audio
            or len(audio) % 2 != 0
            or len(audio) > self.settings.max_audio_chunk_bytes
        ):
            await self._send_json(safe_error("INVALID_AUDIO", "麦克风音频格式无效。"))
            return

        for event in self.turn_detector.feed(audio):
            if isinstance(event, SpeechStarted):
                await self._send_json(server_event("speech_started"))
                await self._send_json(server_event("interrupted"))
                asyncio.create_task(self.tts.cancel())
            elif isinstance(event, SpeechStopped):
                utterance_id = uuid.uuid4().hex
                await self._send_json(
                    server_event("speech_stopped", utteranceId=utterance_id)
                )
                task = asyncio.create_task(self._transcribe(utterance_id, event.audio))
                self.asr_tasks.add(task)
                task.add_done_callback(self.asr_tasks.discard)

    async def _transcribe(self, utterance_id: str, audio: bytes) -> None:
        asr = self.registry.asr
        if asr is None:
            return
        started = time.monotonic()
        try:
            text = await asyncio.to_thread(asr.transcribe, audio)
            if not text:
                await self._send_json(safe_error("ASR_EMPTY", "这句话没有听清，请再说一次。"))
                return
            await self._send_json(
                server_event("transcript", utteranceId=utterance_id, text=text)
            )
            logger.info(
                "event=asr_done session=%s elapsed_ms=%d",
                self.session_id,
                int((time.monotonic() - started) * 1000),
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("event=asr_failed session=%s", self.session_id)
            await self._send_json(safe_error("ASR_FAILED", "语音识别暂时失败，请再试一次。"))

    async def _handle_text(self, raw: str) -> bool:
        try:
            event = parse_client_event(raw, self.settings.max_tts_text_chars)
        except ProtocolError as exc:
            await self._send_json(safe_error("INVALID_CONTROL", str(exc)))
            return False

        if isinstance(event, ControlEvent):
            if event.type == "cancel":
                await self.tts.cancel()
                await self._send_json(server_event("interrupted"))
                return False
            return True
        if isinstance(event, SynthesizeEvent):
            request = TtsRequest(
                response_id=event.response_id,
                segment_id=event.segment_id,
                text=event.text,
            )
            await self._send_json(
                server_event(
                    "audio_start",
                    responseId=request.response_id,
                    segmentId=request.segment_id,
                )
            )
            try:
                await self.tts.synthesize(request)
            except Exception:
                logger.exception("event=tts_start_failed session=%s", self.session_id)
                await self._send_json(safe_error("TTS_FAILED", "声音服务暂时不可用，请稍后重试。"))
        return False

    async def _forward_tts(self) -> None:
        while True:
            output = await self.tts.next_output()
            if output.kind == "audio":
                await self._send_bytes(output.audio)
            elif output.kind == "done":
                await self._send_json(
                    server_event(
                        "audio_done",
                        responseId=output.request.response_id,
                        segmentId=output.request.segment_id,
                    )
                )
            else:
                await self._send_json(safe_error("TTS_FAILED", "声音生成失败，请稍后重试。"))

    async def _send_json(self, payload: dict[str, object]) -> None:
        async with self.send_lock:
            await self.websocket.send_json(payload)

    async def _send_bytes(self, payload: bytes) -> None:
        if not payload:
            return
        async with self.send_lock:
            await self.websocket.send_bytes(payload)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    registry = ModelRegistry(resolved_settings)
    nonce_cache = NonceCache()
    active_subjects: set[str] = set()
    active_lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        loading_task = asyncio.create_task(registry.load())
        yield
        loading_task.cancel()
        await asyncio.gather(loading_task, return_exceptions=True)

    app = FastAPI(
        title="Treehole Split Voice Worker",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        health = registry.health()
        return JSONResponse(
            health,
            status_code=200 if health["ready"] else 503,
            headers={"Cache-Control": "no-store"},
        )

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        origin = websocket.headers.get("origin", "").rstrip("/")
        token = verify_voice_token(
            websocket.query_params.get("token", ""),
            resolved_settings.worker_secret,
        )
        if origin != resolved_settings.app_origin or token is None:
            await websocket.close(code=1008)
            return
        if not nonce_cache.consume(token):
            await websocket.close(code=1008)
            return

        await websocket.accept()
        if not registry.ready:
            await websocket.send_json(
                safe_error("WORKER_WARMING_UP", "语音服务正在预热，请稍后重试。", recoverable=True)
            )
            await websocket.close(code=1013)
            return
        if not resolved_settings.dashscope_api_key:
            await websocket.send_json(
                safe_error("TTS_NOT_CONFIGURED", "声音服务尚未配置。", recoverable=True)
            )
            await websocket.close(code=1011)
            return

        async with active_lock:
            if token.subject in active_subjects:
                await websocket.send_json(
                    safe_error("SESSION_ALREADY_ACTIVE", "这个账号已有一段通话正在进行。")
                )
                await websocket.close(code=1008)
                return
            active_subjects.add(token.subject)

        try:
            await VoiceConnection(websocket, registry, token).run()
        finally:
            async with active_lock:
                active_subjects.discard(token.subject)

    return app


app = create_app()
