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
from livekit.plugins import deepgram, minimax, openai as lk_openai, silero

try:
    from moss import MossClient, QueryOptions
except ImportError:  # optional dependency — search_video degrades gracefully
    MossClient = None
    QueryOptions = None

VIDEO_CONTROL_TOPIC = "video-control"
SPEECH_FALLBACK_TOPIC = "speech-fallback"
MOSS_INDEX_NAME = "dental_procedure"


logger = logging.getLogger("dental-agent")
PIPELINE = "[pipeline]"
QWEN_API_KEY = os.environ.get("QWEN_API_KEY") or os.environ.get("DASHSCOPE_API_KEY", "")
QWEN_BASE_URL = os.environ.get(
    "QWEN_BASE_URL",
    os.environ.get(
        "OPENAI_BASE_HTTP_API_URL",
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    ),
)
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen-turbo")
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_GROUP_ID = os.environ.get("MINIMAX_GROUP_ID", "")
MINIMAX_TTS_BASE_URL = os.environ.get(
    "MINIMAX_TTS_BASE_URL", "https://api.minimax.io/v1/t2a_v2"
)


def _mask_secret(value: str) -> str:
    if not value:
        return "missing"
    if len(value) <= 12:
        return "***"
    return f"{value[:8]}...{value[-4:]}"


async def _check_qwen_llm_auth() -> None:
    client = openai.AsyncClient(api_key=QWEN_API_KEY, base_url=QWEN_BASE_URL)
    try:
        await client.chat.completions.create(
            model=QWEN_MODEL,
            messages=[{"role": "user", "content": "Reply OK."}],
            max_tokens=2,
        )
        logger.info("%s Qwen LLM auth OK base_url=%s model=%s", PIPELINE, QWEN_BASE_URL, QWEN_MODEL)
    except Exception as err:
        logger.exception("%s Qwen LLM auth failed base_url=%s model=%s error=%s", PIPELINE, QWEN_BASE_URL, QWEN_MODEL, err)
    finally:
        await client.close()


async def _check_minimax_tts_auth() -> None:
    url = f"{MINIMAX_TTS_BASE_URL}?GroupId={MINIMAX_GROUP_ID}"
    payload = {
        "model": "speech-02-turbo",
        "text": "OK",
        "stream": True,
        "language_boost": "auto",
        "output_format": "hex",
        "voice_setting": {
            "voice_id": "presenter_female",
            "speed": 1.0,
            "vol": 1.0,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 24000,
            "bitrate": 128000,
            "format": "pcm",
        },
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            async with client.stream(
                "POST",
                url,
                headers={
                    "Authorization": f"Bearer {MINIMAX_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                response.raise_for_status()
                logger.info("%s TTS auth OK base_url=%s", PIPELINE, MINIMAX_TTS_BASE_URL)
    except Exception as err:
        logger.exception("%s TTS auth failed base_url=%s error=%s", PIPELINE, MINIMAX_TTS_BASE_URL, err)


async def _log_llm_tts_startup_health() -> None:
    logger.info(
        "%s Qwen configured key=%s base_url=%s model=%s",
        PIPELINE,
        _mask_secret(QWEN_API_KEY),
        QWEN_BASE_URL,
        QWEN_MODEL,
    )
    logger.info(
        "%s MiniMax TTS configured key=%s group_id=%s base_url=%s",
        PIPELINE,
        _mask_secret(MINIMAX_API_KEY),
        _mask_secret(MINIMAX_GROUP_ID),
        MINIMAX_TTS_BASE_URL,
    )
    if not QWEN_API_KEY:
        logger.error("%s Qwen LLM auth failed — missing QWEN_API_KEY", PIPELINE)
    else:
        await _check_qwen_llm_auth()
    if not MINIMAX_API_KEY or not MINIMAX_GROUP_ID:
        logger.error("%s MiniMax auth failed — missing MINIMAX_API_KEY or MINIMAX_GROUP_ID", PIPELINE)
        return
    await _check_minimax_tts_auth()


def _create_minimax_tts() -> minimax.TTS:
    tts = minimax.TTS(
        api_key=MINIMAX_API_KEY,
        group_id=MINIMAX_GROUP_ID,
        model="speech-02-turbo",
        voice_id="presenter_female",
        sample_rate=24000,
    )
    # The plugin default host rejects international keys; use the same host family
    # as the MiniMax OpenAI-compatible LLM endpoint.
    tts._opts.base_url = MINIMAX_TTS_BASE_URL
    logger.info("%s TTS configured base_url=%s", PIPELINE, MINIMAX_TTS_BASE_URL)
    return tts

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
        self._chip_task: asyncio.Task | None = None
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
        logger.info("%s session.say start — greeting", PIPELINE)
        handle = self.session.say(
            "Hi, I'm your dental study assistant. Ask me anything as you watch.",
            allow_interruptions=True,
        )
        logger.info("%s session.say speech handle created — greeting id=%s", PIPELINE, handle.id)
        await handle.wait_for_playout()
        logger.info("%s audio playout completed — greeting", PIPELINE)

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

    def handle_narrate_segment(self, payload: dict) -> None:
        logger.info("%s narrate_segment received payload=%r", PIPELINE, payload)
        if self._loop is None:
            logger.warning("%s narrate_segment skipped — no loop", PIPELINE)
            return

        ts = float(payload.get("ts", self._current_time_s))
        self._current_time_s = ts
        seg_payload = payload.get("segment")
        if isinstance(seg_payload, dict) and seg_payload.get("step_name"):
            seg = seg_payload
        else:
            seg = _find_segment(ts)

        if not seg:
            logger.warning("%s narrate_segment skipped — no segment ts=%.1f", PIPELINE, ts)
            return

        self._loop.create_task(self._speak_narration(seg))

    async def _speak_narration(self, seg: dict) -> None:
        step = seg.get("step_name", "")
        context = seg.get("context", "")
        phase = seg.get("phase", "")
        try:
            logger.info("%s Qwen LLM request started — narration step=%r", PIPELINE, step)
            handle = self.session.generate_reply(
                instructions=(
                    f"The student pressed play on segment '{step}' (phase: {phase}). "
                    f"Context: {context}. Narrate what is happening in 1-2 short "
                    "plain-English sentences. No lists, no markdown, no timestamps."
                ),
                allow_interruptions=True,
            )
            self._announce_handle = handle
            logger.info("%s session.say / speech handle created — narration id=%s", PIPELINE, handle.id)
            await handle.wait_for_playout()
            logger.info("%s audio playout completed — narration step=%r", PIPELINE, step)
        except Exception:
            logger.exception("%s narration LLM/TTS/playout failed — step=%r", PIPELINE, step)

    async def _do_interrupt(self) -> None:
        try:
            await self.session.interrupt()
        except Exception:
            pass

    def inject_text_question(self, question: str) -> None:
        """Called when user clicks a suggestion chip — treat as a voice turn substitute."""
        self._pre_question_time_s = self._current_time_s
        self._in_question = True
        if self._announce_timer is not None:
            self._announce_timer.cancel()
            self._announce_timer = None
        if self._loop is not None:
            # Cancel previous chip task so only the latest click generates a reply.
            if self._chip_task is not None and not self._chip_task.done():
                self._chip_task.cancel()
            self._chip_task = self._loop.create_task(self._handle_injected_question(question))

    async def _query_moss(self, query: str) -> str:
        """Semantic search over procedure video index. Returns formatted hits or ""."""
        if self._moss is None:
            return ""
        try:
            if not self._moss_loaded:
                await self._moss.load_index(MOSS_INDEX_NAME)
                self._moss_loaded = True
            result = await self._moss.query(MOSS_INDEX_NAME, query, QueryOptions(top_k=5))
            if not result.docs:
                return ""
            return "\n".join(f"- {doc.text}" for doc in result.docs)
        except Exception as exc:
            logger.error("Moss query error: %s", exc)
            return ""

    async def _handle_injected_question(self, question: str) -> None:
        try:
            logger.info("[chip] injected question=%r at %.1fs", question, self._pre_question_time_s)
            try:
                await self.session.interrupt()
            except Exception:
                pass
            await self._send_video_command({"action": "pause"})

            # Pre-query Moss so the answer comes from video content, not LLM knowledge.
            moss_ctx = await self._query_moss(question)
            logger.info("[chip] moss returned %d chars for question=%r", len(moss_ctx), question)

            # interrupt() may have left a FunctionCall with broken JSON arguments in the
            # chat context. MiniMax rejects these with 400. Strip them before replying.
            chat_ctx = None
            try:
                ctx = self.session.history.copy()
                bad_call_ids: set[str] = set()
                clean_items = []
                for item in ctx.items:
                    item_type = getattr(item, "type", None)
                    if item_type == "function_call":
                        try:
                            json.loads(item.arguments)
                            clean_items.append(item)
                        except (json.JSONDecodeError, ValueError):
                            bad_call_ids.add(item.call_id)
                            logger.info("[chip] removed malformed FunctionCall call_id=%s name=%s", item.call_id, item.name)
                    elif item_type == "function_call_output" and item.call_id in bad_call_ids:
                        logger.info("[chip] removed orphaned FunctionCallOutput call_id=%s", item.call_id)
                    else:
                        clean_items.append(item)
                ctx.items = clean_items
                chat_ctx = ctx
            except Exception as exc:
                logger.warning("[chip] ctx cleanup failed: %s", exc)

            instructions = None
            if moss_ctx:
                instructions = (
                    f"Context from the procedure video:\n{moss_ctx}\n"
                    "Answer the user's question in 1-2 plain sentences using only this context. "
                    "Do not call search_video — context is already provided above."
                )

            kwargs: dict[str, Any] = {"user_input": question, "allow_interruptions": True}
            if chat_ctx is not None:
                kwargs["chat_ctx"] = chat_ctx
            if instructions:
                kwargs["instructions"] = instructions
            self.session.generate_reply(**kwargs)
        except asyncio.CancelledError:
            logger.info("[chip] task cancelled for question=%r (newer chip click arrived)", question)
            raise

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

    async def _send_speech_fallback(self, text: str, reason: str) -> None:
        if not text.strip():
            return
        try:
            room = get_job_context().room
            payload = {"type": "speech_fallback", "text": text, "reason": reason}
            await room.local_participant.publish_data(
                json.dumps(payload).encode("utf-8"),
                reliable=True,
                topic=SPEECH_FALLBACK_TOPIC,
            )
            logger.info("%s browser speech fallback sent reason=%s text=%r", PIPELINE, reason, text[:300])
        except Exception as exc:
            logger.error("%s browser speech fallback failed reason=%s error=%s", PIPELINE, reason, exc)

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
        result = await self._query_moss(query)
        if not result:
            return "Knowledge base not configured." if self._moss is None else "No relevant information found."
        return result


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    await _log_llm_tts_startup_health()

    video_id = ctx.room.name  # room name == videoId set by the token route
    next_url = os.environ.get("NEXT_URL", "http://localhost:3000")

    agent = DentalAgent(video_id=video_id)

    @ctx.room.on("data_received")
    def on_data(data_packet: rtc.DataPacket) -> None:
        raw = ""
        try:
            raw = data_packet.data.decode(errors="replace")
            logger.info(
                "%s data_received raw=%r topic=%s from=%s",
                PIPELINE,
                raw[:1000],
                data_packet.topic,
                getattr(data_packet.participant, "identity", "?"),
            )
            payload = json.loads(raw)
            if payload.get("type") == "video_timestamp":
                agent.update_timestamp(float(payload["ts"]))
            elif payload.get("type") == "user_interrupt":
                agent.handle_interrupt()
            elif payload.get("type") == "text_question":
                question = str(payload.get("question", "")).strip()
                if question:
                    agent.inject_text_question(question)
            elif payload.get("type") == "narrate_segment":
                agent.handle_narrate_segment(payload)
        except Exception:
            logger.exception("%s data_received handler error raw=%r", PIPELINE, raw[:1000])

    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="en-US"),
        llm=lk_openai.LLM(
            model=QWEN_MODEL,
            api_key=QWEN_API_KEY,
            base_url=QWEN_BASE_URL,
        ),
        tts=_create_minimax_tts(),
        vad=silero.VAD.load(),
        tts_text_transforms=[_strip_leaked_calls, "filter_markdown"],
    )
    last_agent_text = ""

    @session.on("agent_state_changed")
    def on_agent_state_changed(ev: Any) -> None:
        logger.info("%s agent state — %s → %s", PIPELINE, ev.old_state, ev.new_state)
        if ev.new_state == "thinking":
            logger.info("%s Qwen LLM request started", PIPELINE)
        if ev.new_state == "speaking":
            logger.info("%s MiniMax TTS start", PIPELINE)
        if ev.old_state == "speaking" and ev.new_state == "listening":
            logger.info("%s MiniMax TTS end", PIPELINE)

    @session.on("conversation_item_added")
    def on_conversation_item_added(ev: Any) -> None:
        nonlocal last_agent_text
        item = ev.item
        role = getattr(item, "role", None) or getattr(item, "type", "unknown")
        text = getattr(item, "text_content", None) or getattr(item, "content", "")
        text_s = str(text)
        if role in {"assistant", "agent", "agent_handoff"} and text_s.strip():
            last_agent_text = text_s
        logger.info("%s Qwen LLM response text — role=%s text=%r", PIPELINE, role, text_s[:500])

    @session.on("speech_created")
    def on_speech_created(ev: Any) -> None:
        logger.info(
            "%s speech handle created — source=%s user_initiated=%s",
            PIPELINE,
            ev.source,
            ev.user_initiated,
        )

    @session.on("error")
    def on_session_error(ev: Any) -> None:
        logger.error("%s session error — source=%s error=%r", PIPELINE, ev.source, ev.error, exc_info=getattr(ev.error, "error", ev.error))
        source = str(getattr(ev, "source", "")).lower()
        if "tts" in source or "synthesize" in source:
            asyncio.create_task(agent._send_speech_fallback(last_agent_text, f"tts:{ev.source}"))

    await session.start(agent, room=ctx.room)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="dental-coach-red-test-1111"))
