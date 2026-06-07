"""
Amazon Transcribe Medical streaming STT plugin for LiveKit Agents.

Uses `aws_sdk_transcribe_streaming` (already installed as a dep of
livekit-plugins-aws) — no extra packages needed.

Specialty "PRIMARYCARE" covers dental/oral procedures. Other options:
CARDIOLOGY, NEUROLOGY, ONCOLOGY, RADIOLOGY, UROLOGY.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from typing import Any, Literal

from livekit import rtc
from livekit.agents import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions, LanguageCode
from livekit.agents import stt as lk_stt
from livekit.agents.utils import is_given
from livekit.agents.types import NOT_GIVEN, NotGivenOr

from aws_sdk_transcribe_streaming.client import TranscribeStreamingClient
from aws_sdk_transcribe_streaming.config import Config
from aws_sdk_transcribe_streaming.models import (
    AudioEvent,
    AudioStream,
    AudioStreamAudioEvent,
    MedicalTranscriptResultStreamTranscriptEvent,
    StartMedicalStreamTranscriptionInput,
)
from smithy_aws_core.identity import EnvironmentCredentialsResolver

logger = logging.getLogger("dental-agent.stt-medical")

MedicalSpecialty = Literal[
    "PRIMARYCARE", "CARDIOLOGY", "NEUROLOGY", "ONCOLOGY", "RADIOLOGY", "UROLOGY"
]

DEFAULT_REGION = "us-east-1"


class TranscribeMedicalSTT(lk_stt.STT):
    """LiveKit STT plugin backed by Amazon Transcribe Medical (streaming)."""

    def __init__(
        self,
        *,
        specialty: MedicalSpecialty = "PRIMARYCARE",
        region: NotGivenOr[str] = NOT_GIVEN,
        sample_rate: int = 16000,
    ) -> None:
        super().__init__(
            capabilities=lk_stt.STTCapabilities(
                streaming=True,
                interim_results=True,
                offline_recognize=False,
            )
        )
        self._specialty = specialty
        self._region = (
            region if is_given(region)
            else os.environ.get("AWS_DEFAULT_REGION", DEFAULT_REGION)
        )
        self._sample_rate = sample_rate

    @property
    def model(self) -> str:
        return f"transcribe-medical-{self._specialty.lower()}"

    @property
    def provider(self) -> str:
        return "aws"

    async def _recognize_impl(self, buffer: Any, *, language: Any = None, conn_options: Any = None) -> Any:
        raise NotImplementedError("TranscribeMedicalSTT is streaming-only")

    def stream(
        self,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "TranscribeMedicalStream":
        return TranscribeMedicalStream(
            stt=self,
            specialty=self._specialty,
            region=self._region,
            sample_rate=self._sample_rate,
            conn_options=conn_options,
        )


class TranscribeMedicalStream(lk_stt.SpeechStream):
    def __init__(
        self,
        *,
        stt: TranscribeMedicalSTT,
        specialty: str,
        region: str,
        sample_rate: int,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(stt=stt, conn_options=conn_options, sample_rate=sample_rate)
        self._specialty = specialty
        self._region = region
        self._sample_rate = sample_rate

    async def _run(self) -> None:
        while True:
            client = TranscribeStreamingClient(
                config=Config(
                    region=self._region,
                    aws_credentials_identity_resolver=EnvironmentCredentialsResolver(),
                )
            )

            stream = await client.start_medical_stream_transcription(
                input=StartMedicalStreamTranscriptionInput(
                    language_code="en-US",
                    media_sample_rate_hertz=self._sample_rate,
                    media_encoding="pcm",
                    specialty=self._specialty,
                    type="CONVERSATION",
                )
            )

            _, output_stream = await stream.await_output()
            tasks: list[asyncio.Task[Any]] = []

            try:
                async def send_audio(audio_stream: Any) -> None:
                    try:
                        async for frame in self._input_ch:
                            if isinstance(frame, rtc.AudioFrame):
                                await audio_stream.send(
                                    AudioStreamAudioEvent(
                                        value=AudioEvent(audio_chunk=frame.data.tobytes())
                                    )
                                )
                    finally:
                        with contextlib.suppress(Exception):
                            await audio_stream.send(
                                AudioStreamAudioEvent(value=AudioEvent(audio_chunk=b""))
                            )
                        with contextlib.suppress(Exception):
                            await audio_stream.close()

                async def handle_events(out_stream: Any) -> None:
                    async for event in out_stream:
                        if isinstance(event.value, MedicalTranscriptResultStreamTranscriptEvent):
                            self._process_event(event.value.value)

                tasks = [
                    asyncio.create_task(send_audio(stream.input_stream)),
                    asyncio.create_task(handle_events(output_stream)),
                ]

                await asyncio.shield(asyncio.gather(*tasks))
                return  # clean exit

            except Exception as exc:
                msg = str(exc)
                if "timed out" in msg.lower():
                    logger.info("Transcribe Medical session timed out — reconnecting")
                    continue
                raise
            finally:
                if tasks:
                    from livekit.agents import utils
                    await utils.aio.gracefully_cancel(tasks[0])
                    with contextlib.suppress(Exception):
                        await asyncio.wait_for(tasks[1], timeout=3.0)

    def _process_event(self, event: Any) -> None:
        if not event.transcript or not event.transcript.results:
            return

        for result in event.transcript.results:
            if not result.alternatives:
                continue
            text = result.alternatives[0].transcript
            if not text or not text.strip():
                continue

            if result.start_time == 0.0:
                self._event_ch.send_nowait(
                    lk_stt.SpeechEvent(type=lk_stt.SpeechEventType.START_OF_SPEECH)
                )

            speech_data = lk_stt.SpeechData(
                language=LanguageCode("en-US"),
                text=text,
                start_time=(result.start_time or 0.0) + self.start_time_offset,
                end_time=(result.end_time or 0.0) + self.start_time_offset,
                confidence=0.9,
            )

            if result.is_partial:
                self._event_ch.send_nowait(
                    lk_stt.SpeechEvent(
                        type=lk_stt.SpeechEventType.INTERIM_TRANSCRIPT,
                        alternatives=[speech_data],
                    )
                )
            else:
                self._event_ch.send_nowait(
                    lk_stt.SpeechEvent(
                        type=lk_stt.SpeechEventType.FINAL_TRANSCRIPT,
                        alternatives=[speech_data],
                    )
                )
                self._event_ch.send_nowait(
                    lk_stt.SpeechEvent(type=lk_stt.SpeechEventType.END_OF_SPEECH)
                )
