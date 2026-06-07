import asyncio
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

import httpx
import openai
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, function_tool
from livekit.plugins import deepgram, minimax, silero

logger = logging.getLogger("dental-agent")

INSTRUCTIONS = """You are a warm, knowledgeable dental education assistant.

When the user first joins:
1. Greet them and ask about their background (dental student, resident, practicing clinician, or patient?)
2. Ask what they hope to learn from this procedure video
3. Ask if they have any specific questions already in mind
Call save_user_intent() once you have a clear picture of their goals.

You have two tools to use throughout the session:
- check_video_status(): call this to see whether the video has finished processing
- search_video(): call this before answering any question about a specific moment or technique

Once the video is ready, switch to Q&A mode. Always call search_video() before answering procedure
questions, and cite the timestamp in your response (e.g. "At 42 seconds...").

Keep all responses concise — this is a voice conversation."""


class DentalAgent(Agent):
    def __init__(self, video_id: str) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self._video_id = video_id
        self._next_url = os.environ.get("NEXT_URL", "http://localhost:3000")
        moss_key = os.environ.get("MOSS_API_KEY", "")
        if moss_key and moss_key != "xxx":
            import moss
            self._moss_index = moss.Index(api_key=moss_key, index=f"video_{video_id}")
        else:
            self._moss_index = None

    async def on_enter(self) -> None:
        await self.session.say(
            "Hello! I'm your dental procedure learning assistant. "
            "While the video is processing, I'd love to learn a bit about you. "
            "Are you a dental student, a resident, a practicing clinician, or a patient? "
            "And what do you hope to learn from this procedure video?",
            allow_interruptions=True,
        )

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

    async def announce_when_ready() -> None:
        """Poll video status and announce when processing finishes."""
        await asyncio.sleep(8)  # wait for greeting to finish before polling
        async with httpx.AsyncClient() as client:
            while True:
                try:
                    r = await client.get(
                        f"{next_url}/api/videos/{video_id}", timeout=5.0
                    )
                    if r.json().get("status") == "ready":
                        await session.say(
                            "Good news — the video is ready. "
                            "You can now ask me about any specific moment or technique.",
                            allow_interruptions=True,
                        )
                        return
                except Exception as exc:
                    logger.warning("Poll error: %s", exc)
                await asyncio.sleep(5)

    asyncio.ensure_future(announce_when_ready())


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="dental-coach"))
