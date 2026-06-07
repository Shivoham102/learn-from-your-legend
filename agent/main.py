import logging
import os

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

_NOISY = (
    "smithy_http", "smithy_core", "smithy_aws_core",
    "smithy_aws_transcribe_streaming",
    "smithy_aws_event_stream", "smithy_aws_event_stream.aio",
    "aws_sdk_transcribe_streaming",
    "aiobotocore", "aioboto3", "botocore", "urllib3",
)
_null = logging.NullHandler()
for _name in _NOISY:
    _lg = logging.getLogger(_name)
    _lg.addHandler(_null)
    _lg.propagate = False      # records never reach root — survives any basicConfig call
    _lg.setLevel(logging.CRITICAL)

import json

import httpx
import openai
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    WorkerOptions,
    cli,
    function_tool,
    get_job_context,
)
from livekit import rtc
from livekit.agents import llm as _lk_llm
from livekit.plugins import deepgram, minimax, silero

VIDEO_CONTROL_TOPIC = "video-control"


class _TolerantCompletionUsage(_lk_llm.CompletionUsage):
    """MiniMax streams a trailing usage chunk with null token counts, which the
    stock plugin feeds straight into CompletionUsage (int fields) and crashes
    pydantic. Coerce the null counts to 0 so the stream completes."""

    def __init__(self, **data):
        for _k in ("completion_tokens", "prompt_tokens", "total_tokens"):
            if data.get(_k) is None:
                data[_k] = 0
        super().__init__(**data)


# Patch the class the minimax plugin resolves at call time (it does
# `from livekit.agents import llm` then `llm.CompletionUsage(...)`).
_lk_llm.CompletionUsage = _TolerantCompletionUsage

logger = logging.getLogger("dental-agent")

_SEGMENTS_PATH = Path(__file__).parent.parent / "Speeden root canal 1.5.json"


def _load_segments() -> list[dict]:
    try:
        return json.loads(_SEGMENTS_PATH.read_text(encoding="utf-8")).get("segments", [])
    except Exception as exc:
        logger.warning("Could not load procedure segments: %s", exc)
        return []


_PROCEDURE_SEGMENTS = _load_segments()


def _mm_ss_to_s(ts: str) -> float:
    try:
        m, s = ts.split(":")
        return int(m) * 60 + int(s)
    except (ValueError, IndexError):
        return 0.0


def _find_segment(time_s: float) -> dict | None:
    """Return the segment covering time_s; fall back to last segment at/past video end."""
    last = None
    for seg in _PROCEDURE_SEGMENTS:
        start = _mm_ss_to_s(seg.get("start", "0:00"))
        end = _mm_ss_to_s(seg.get("end", "0:00"))
        if start <= time_s < end:
            return seg
        if start <= time_s:
            last = seg
    return last


INSTRUCTIONS = """You are a dental procedure study assistant for a voice conversation.

Your audience is dental students. Do not ask about their background — assume they are students.

STYLE — this matters most:
- Be concise and direct. Answer in 1-2 short sentences. No fluff, no filler, no preamble.
- Do not restate the question or add pleasantries. Get to the point.
- Speak plainly; expand only if the user asks for more detail.
- This is spoken aloud. Never use lists, bullet points, or numbered steps — they get read out as
  "one, two, three". Always answer in plain flowing sentences.
- Never mention timestamps, seconds, or "the X-second mark". Use get_current_segment() to know what
  is on screen, but describe what is happening, not when. The viewer can already see the time.

Tools:
- get_current_segment(): call FIRST when the user asks what is happening on screen now, what step is
  being performed, or what instruments or anatomy are involved. Tells you the current procedure segment.
- check_video_status(): whether the video has finished processing.
- search_video(): call before answering any question about a specific moment or technique.

Video controls — call when asked:
- play_video() / pause_video()
- rewind_video(seconds) / forward_video(seconds) (default 10)
- seek_video(timestamp): jump to an absolute time in seconds."""


class DentalAgent(Agent):
    def __init__(self, video_id: str) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self._video_id = video_id
        self._current_time_s: float = 0.0
        self._next_url = os.environ.get("NEXT_URL", "http://localhost:3000")
        moss_key = os.environ.get("MOSS_API_KEY", "")
        if moss_key and moss_key != "xxx":
            import moss
            self._moss_index = moss.Index(api_key=moss_key, index=f"video_{video_id}")
        else:
            self._moss_index = None

    def update_timestamp(self, ts: float) -> None:
        self._current_time_s = ts

    @function_tool()
    async def get_current_segment(self) -> str:
        """Return the procedure segment currently on screen based on the video timestamp.
        Call this before answering any question about what is happening right now."""
        seg = _find_segment(self._current_time_s)
        if not seg:
            return f"No segment data available (timestamp {self._current_time_s:.1f}s)"
        return json.dumps({
            "timestamp_s": self._current_time_s,
            "step": seg.get("step_name"),
            "phase": seg.get("phase"),
            "context": seg.get("context"),
            "instruments": seg.get("instruments", []),
            "anatomy": seg.get("anatomy", []),
            "materials": seg.get("materials", []),
        })

    async def on_enter(self) -> None:
        await self.session.say(
            "Hi, I'm your dental study assistant. Ask me anything as you watch.",
            allow_interruptions=True,
        )

    async def _send_video_command(self, command: dict) -> None:
        """Publish a structured video-control command to the frontend over the
        LiveKit data channel. The browser decodes it and drives the <video>."""
        try:
            room = get_job_context().room
            await room.local_participant.publish_data(
                json.dumps(command).encode("utf-8"),
                reliable=True,
                topic=VIDEO_CONTROL_TOPIC,
            )
            logger.info("Sent video command: %s", command)
        except Exception as exc:
            logger.error("Failed to send video command %s: %s", command, exc)

    @function_tool()
    async def play_video(self) -> str:
        """Resume playback of the procedure video.
        Use when the user says 'play', 'resume', or 'continue'."""
        await self._send_video_command({"action": "play"})
        return "Playing the video."

    @function_tool()
    async def pause_video(self) -> str:
        """Pause the procedure video.
        Use when the user says 'pause', 'stop', or 'hold on'."""
        await self._send_video_command({"action": "pause"})
        return "Paused the video."

    @function_tool()
    async def rewind_video(self, seconds: int = 10) -> str:
        """Rewind the procedure video by a number of seconds (default 10).
        Use when the user says 'go back' or 'rewind'."""
        await self._send_video_command({"action": "rewind", "seconds": seconds})
        return f"Rewound {seconds} seconds."

    @function_tool()
    async def forward_video(self, seconds: int = 10) -> str:
        """Skip the procedure video forward by a number of seconds (default 10).
        Use when the user says 'skip ahead' or 'forward'."""
        await self._send_video_command({"action": "forward", "seconds": seconds})
        return f"Skipped forward {seconds} seconds."

    @function_tool()
    async def seek_video(self, timestamp: float) -> str:
        """Jump the procedure video to an absolute timestamp in seconds.
        Use when the user says 'jump to 42 seconds' or 'go to one minute'."""
        await self._send_video_command({"action": "seek", "timestamp": timestamp})
        return f"Jumped to {timestamp:g} seconds."

    @function_tool()
    async def check_video_status(self) -> str:
        """Check whether the dental procedure video has finished processing."""
        async with httpx.AsyncClient() as client:
            try:
                r = await client.get(
                    f"{self._next_url}/api/videos/{self._video_id}",
                    timeout=5.0,
                )
                data = r.json()
                status = data.get("status", "unknown")
                progress = data.get("progress", 0)
                return f"Video status: {status} ({progress}% complete)"
            except Exception as exc:
                logger.warning("Status check failed: %s", exc)
                return f"Could not check status: {exc}"

    @function_tool()
    async def search_video(self, query: str) -> str:
        """Search the dental procedure video content for context relevant to a question.
        Always call this before answering questions about specific moments or techniques."""
        if self._moss_index is None:
            return "Video search index not configured yet."
        try:
            results = self._moss_index.query(query, k=5)
            if not results:
                return "No relevant content found yet — the video may still be processing."
            return "\n".join(
                f"[{r.metadata.get('t', '?')}s] {r.text}" for r in results
            )
        except Exception as exc:
            logger.error("Moss query error: %s", exc)
            return f"Could not retrieve video context: {exc}"

    @function_tool()
    async def save_user_intent(self, summary: str) -> str:
        """Save a summary of the user's background and learning goals so they inform
        later answers. Call once you know who the user is and what they want to learn."""
        if self._moss_index is None:
            logger.info("Moss not configured; intent not persisted: %s", summary)
            return "Intent noted (search index not configured)."
        try:
            self._moss_index.upsert(
                id="user_intent",
                text=summary,
                metadata={"type": "intent"},
            )
            logger.info("User intent saved: %s", summary)
            return "Intent saved."
        except Exception as exc:
            logger.error("Moss upsert error: %s", exc)
            return f"Could not save intent: {exc}"


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    video_id = ctx.room.name  # room name == videoId set by the token route
    next_url = os.environ.get("NEXT_URL", "http://localhost:3000")

    agent = DentalAgent(video_id=video_id)

    @ctx.room.on("data_received")
    def on_data(data_packet: rtc.DataPacket) -> None:
        try:
            payload = json.loads(data_packet.data.decode())
            if payload.get("type") == "video_timestamp":
                agent.update_timestamp(float(payload["ts"]))
        except Exception:
            pass

    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="en-US"),
        llm=minimax.LLM(
            client=openai.AsyncClient(
                api_key=os.environ.get("MINIMAX_API_KEY"),
                base_url="https://api.minimax.io/v1",
            )
        ),
        tts=minimax.TTS(model="speech-02-turbo", voice_id="presenter_female", sample_rate=24000),
        vad=silero.VAD.load(),
    )

    await session.start(agent, room=ctx.room)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="dental-coach"))
