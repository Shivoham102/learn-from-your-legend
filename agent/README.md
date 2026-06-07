# Dental Coach — LiveKit Voice Agent

Python voice agent using AWS Transcribe Medical (STT), MiniMax (LLM + TTS), and Moss (retrieval).

## Setup

```bash
cd agent
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Fill in all values in .env
```

Required env vars: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`,
`MINIMAX_API_KEY`, `MINIMAX_GROUP_ID`, `MOSS_API_KEY`, `NEXT_URL`

## Run

```bash
# Dev mode (auto-reload on changes)
python main.py dev

# Production
python main.py start
```

## How it works

1. Worker registers with LiveKit. When a user joins a room (room name = videoId), LiveKit dispatches the agent.
2. **Phase 1** — while the video processes, the agent asks about the user's background and learning goals, then saves a summary to Moss via `save_user_intent()`.
3. **Phase 2** — when the video is ready (detected by polling `/api/videos/{videoId}`), the agent announces readiness and switches to Q&A mode. Every answer calls `search_video()` to pull relevant frame context from Moss.

## Moss index schema

Index name: `video_{videoId}`

| Doc ID | Content | Metadata |
|--------|---------|----------|
| `frame_{t}` | Frame description at timestamp `t` | `{type: "frame", t: <seconds>}` |
| `user_intent` | User background + learning goals | `{type: "intent"}` |

Frame docs are written by the video processing pipeline (currently stubbed in `src/lib/video-processor.ts`).
