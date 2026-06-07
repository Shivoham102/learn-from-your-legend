import asyncio
import logging
import os
import re
from typing import Any

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
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
    get_job_context,
)
from livekit import rtc
from livekit.agents import llm as _lk_llm
from livekit.plugins import deepgram, minimax, silero
from livekit.plugins.minimax import llm as _mm_llm

try:
    from moss import MossClient, QueryOptions
except ImportError:  # optional dependency — search_video degrades gracefully
    MossClient = None
    QueryOptions = None

VIDEO_CONTROL_TOPIC = "video-control"
MOSS_INDEX_NAME = "dental_procedure"


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


# MiniMax rejects a tool call whose arguments are an empty string ("invalid
# function arguments json string"). No-argument tools (e.g. get_current_segment)
# serialize as "", so coerce empty tool-call arguments to "{}" before each request.
_orig_to_chat_ctx = _mm_llm.to_chat_ctx


def _patched_to_chat_ctx(chat_ctx, cache_key):
    msgs = _orig_to_chat_ctx(chat_ctx, cache_key)
    for m in msgs:
        tool_calls = m.get("tool_calls") if isinstance(m, dict) else None
        for tc in tool_calls or []:
            fn = tc.get("function") if isinstance(tc, dict) else None
            if isinstance(fn, dict) and not (fn.get("arguments") or "").strip():
                fn["arguments"] = "{}"
    return msgs


_mm_llm.to_chat_ctx = _patched_to_chat_ctx

logger = logging.getLogger("dental-agent")

# MiniMax sometimes emits tool-call syntax as plain text instead of executing function calls.
# Strip it before TTS via tts_text_transforms (runs first, before filter_markdown).
_FUNC_CALL_LINE_RE = re.compile(r"functions\.\w+\s*\(")


async def _strip_leaked_calls(text):
    """Remove fenced code blocks and function-call lines from the LLM token stream."""
    buffer = ""
    in_code_block = False
    async for chunk in text:
        buffer += chunk
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            stripped = line.strip()
            if stripped.startswith("```"):
                in_code_block = not in_code_block
                continue  # drop the fence line itself
            if in_code_block:
                continue  # drop code block content
            if _FUNC_CALL_LINE_RE.search(line):
                continue  # drop bare function-call lines
            yield line + "\n"
    if buffer:
        if not in_code_block and not _FUNC_CALL_LINE_RE.search(buffer) and not buffer.strip().startswith("```"):
            yield buffer

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

Your audience is dental students. Do not ask about their background.

OUTPUT RULES — non-negotiable:
This is a voice conversation. Your text goes directly to a text-to-speech engine.
NEVER output code, function calls, JSON, markdown, bullet points, numbered lists, or backticks.
They will be spoken aloud verbatim and sound completely broken to the listener.
NEVER write things like "functions.search_video(...)" or backtick code blocks — call tools silently
and speak only the plain-English answer.
Always answer in plain flowing sentences only.

STYLE:
Concise and direct. 1-2 sentences. No fluff, no preamble, no restating the question.
Never mention timestamps, seconds, or "the X-second mark". Describe what is happening, not when.

TOOLS — always call silently, never write them in your response:
get_current_segment(): call FIRST when asked what is on screen now, what step, what instruments,
or what anatomy is involved.
search_video(query): call before answering any question about a technique, instrument, material,
or why a step is done. Use this for all knowledge questions.
seek_to_segment(name): call this whenever the user asks ABOUT or asks to SEE a named segment
(e.g. "explain decay removal", "what is rubber dam", "show me obturation"). Always call this
BEFORE answering so the video shows the relevant segment while you explain. Use the step name
from the JSON as the argument.
resume_from_question(): ALWAYS call this after answering any knowledge question — it returns
the video to where the user was and resumes playback. Only skip it for pure navigation commands
("take me to X", "skip to Y") where the user wants to stay at the new position.
check_video_status(): check if video finished processing.
play_video() / pause_video() / rewind_video(seconds) / forward_video(seconds) / seek_video(timestamp)"""


class DentalAgent(Agent):
    def __init__(self, video_id: str) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self._video_id = video_id
        self._current_time_s: float = 0.0
        self._next_url = os.environ.get("NEXT_URL", "http://localhost:3000")
        project_id = os.environ.get("MOSS_PROJECT_ID", "")
        project_key = os.environ.get("MOSS_PROJECT_KEY", "")
        if MossClient and project_id and project_key:
            self._moss = MossClient(project_id, project_key)
        else:
            self._moss = None
        self._moss_loaded = False
        self._last_announced_segment_id: str | None = None
        self._announce_timer: asyncio.TimerHandle | None = None
        self._announce_handle: Any = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._pre_question_time_s: float | None = None
        self._in_question: bool = False

    def update_timestamp(self, ts: float) -> None:
        self._current_time_s = ts
        if self._in_question:
            return
        seg = _find_segment(ts)
        if seg is None:
            self._last_announced_segment_id = None
            if self._announce_timer is not None:
                self._announce_timer.cancel()
                self._announce_timer = None
            return
        seg_id = seg.get("id")
        if seg_id == self._last_announced_segment_id:
            return
        self._last_announced_segment_id = seg_id
        if self._loop is None:
            return
        if self._announce_timer is not None:
            self._announce_timer.cancel()
        self._announce_timer = self._loop.call_later(1.2, self._fire_announce, seg)

    def _fire_announce(self, seg: dict) -> None:
        self._announce_timer = None
        if self._announce_handle is not None and not self._announce_handle.done():
            try:
                self._announce_handle.interrupt(force=True)
            except Exception:
                pass
        step = seg.get("step_name", "")
        context = seg.get("context", "")
        phase = seg.get("phase", "")
        try:
            self._announce_handle = self.session.generate_reply(
                instructions=(
                    f"The video just entered a new segment: '{step}' (phase: {phase}). "
                    f"Context: {context}. "
                    "Say 1-2 short plain-English sentences introducing what's happening. "
                    "No lists, no markdown, no timestamps."
                ),
                allow_interruptions=True,
            )
        except Exception as exc:
            logger.error("Segment announce failed for '%s': %s", seg.get("id"), exc)

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
        self._loop = asyncio.get_running_loop()
        seg = _find_segment(self._current_time_s)
        if seg:
            self._last_announced_segment_id = seg.get("id")
        await self.session.say(
            "Hi, I'm your dental study assistant. Ask me anything as you watch.",
            allow_interruptions=True,
        )

    async def on_user_turn_completed(self, turn_ctx: Any, new_message: Any) -> None:
        self._pre_question_time_s = self._current_time_s
        self._in_question = True
        if self._announce_timer is not None:
            self._announce_timer.cancel()
            self._announce_timer = None
        logger.info(
            "[Q&A] user turn completed — saved position=%.1fs, pausing video",
            self._pre_question_time_s,
        )
        await self._send_video_command({"action": "pause"})

    def handle_interrupt(self) -> None:
        if self._loop:
            self._loop.create_task(self._do_interrupt())

    async def _do_interrupt(self) -> None:
        try:
            await self.session.interrupt()
        except Exception:
            pass

    async def on_exit(self) -> None:
        if self._announce_timer is not None:
            self._announce_timer.cancel()
            self._announce_timer = None
        if self._announce_handle is not None and not self._announce_handle.done():
            try:
                self._announce_handle.interrupt(force=True)
            except Exception:
                pass

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
    async def seek_to_segment(self, name: str) -> str:
        """Jump to a named procedure segment using the exact start time from the JSON.
        Use this — not rewind_video — whenever the user mentions a section, step, or phase by name
        (e.g. 'decay removal', 'rubber dam', 'obturation', 'onlay prep').
        Matches against step_name, phase, and context fields."""
        query = name.lower()
        query_words = set(query.split())

        best_seg = None
        best_score = -1
        for seg in _PROCEDURE_SEGMENTS:
            haystack = " ".join([
                seg.get("step_name", ""),
                seg.get("phase", ""),
                seg.get("context", ""),
            ]).lower()
            hay_words = set(haystack.split())
            score = len(query_words & hay_words)
            if score > best_score:
                best_score = score
                best_seg = seg

        if not best_seg or best_score == 0:
            logger.warning("[seek_to_segment] no match for query=%r — available: %s", name,
                           [s.get("step_name") for s in _PROCEDURE_SEGMENTS])
            return f"No segment matched '{name}'. Available: {', '.join(s.get('step_name','') for s in _PROCEDURE_SEGMENTS)}"

        start_s = _mm_ss_to_s(best_seg.get("start", "0:00"))
        logger.info("[seek_to_segment] query=%r → matched=%r score=%d seeking to %.1fs",
                    name, best_seg.get("step_name"), best_score, start_s)
        await self._send_video_command({"action": "seek", "timestamp": start_s})
        return f"Jumped to '{best_seg.get('step_name')}' (starts at {best_seg.get('start')})."

    @function_tool()
    async def resume_from_question(self, context: RunContext) -> str:
        """Return to the video position the user was at before asking their question and resume playback.
        Call this after finishing any knowledge explanation. Do NOT call after navigation commands."""
        ts = self._pre_question_time_s if self._pre_question_time_s is not None else self._current_time_s
        logger.info(
            "[resume_from_question] called — waiting for playout then returning to %.1fs (pre_question=%.1fs, current=%.1fs)",
            ts,
            self._pre_question_time_s if self._pre_question_time_s is not None else -1,
            self._current_time_s,
        )
        await context.wait_for_playout()
        logger.info("[resume_from_question] playout done — seeking to %.1fs and playing", ts)
        if self._announce_timer is not None:
            self._announce_timer.cancel()
            self._announce_timer = None
        self._in_question = False
        await self._send_video_command({"action": "seek", "timestamp": ts})
        await self._send_video_command({"action": "play"})
        return f"Resumed playback from {ts:.1f}s."

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
        """Search the dental knowledge base (instruments, materials, anatomy, terms,
        procedure steps, clinical rationale, common student questions) for context
        relevant to a question. Call before answering questions about techniques,
        instruments, materials, anatomy, or why a step is done."""
        if self._moss is None:
            return "Knowledge base not configured."
        try:
            if not self._moss_loaded:
                await self._moss.load_index(MOSS_INDEX_NAME)
                self._moss_loaded = True
            result = await self._moss.query(
                MOSS_INDEX_NAME, query, QueryOptions(top_k=5)
            )
            if not result.docs:
                return "No relevant information found."
            return "\n".join(f"- {doc.text}" for doc in result.docs)
        except Exception as exc:
            logger.error("Moss query error: %s", exc)
            return f"Could not retrieve knowledge: {exc}"


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
            elif payload.get("type") == "user_interrupt":
                agent.handle_interrupt()
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
        tts_text_transforms=[_strip_leaked_calls, "filter_markdown"],
    )

    await session.start(agent, room=ctx.room)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="dental-coach"))
