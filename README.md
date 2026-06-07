# ProbeIQ

ProbeIQ is a real-time dental procedure coaching agent with interruptible voice Q&A. A student watches a procedure video, hears a voice explanation of what is happening, and can interrupt at any moment to ask a question. Moss retrieves the most relevant procedure context fast, and the agent can jump the video back to the exact moment that answers the doubt.

Built for the [YC Conversational AI Hackathon 2026](https://events.ycombinator.com/conversational-ai-hackathon-2026), ProbeIQ shows how a voice tutor can feel grounded, responsive, and visual instead of behaving like a generic chatbot layered on top of a video.

## Demo Flow

1. A dental procedure video is analyzed into structured teaching segments.
2. The student opens ProbeIQ and watches the procedure in the browser.
3. The LiveKit voice agent narrates the active segment and listens for interruptions.
4. When the student asks a question, the agent pauses the video, searches Moss for relevant dental context, answers through voice, and uses the LiveKit data channel to seek, rewind, or resume the video.
5. The UI highlights supporting knowledge: procedure cards, dental terms, reference images, and tooth-stage comparisons.

## Why Moss Matters

Voice education breaks when retrieval is slow. In this project, Moss acts as the semantic retrieval layer for dental terms, instruments, materials, anatomy, common doubts, clinical rationale, and procedure moments. That lets the agent answer questions during playback without drifting away from the exact visual context.

Moss is especially important for the interruption flow: the student can stop the tutor mid-explanation, ask "why are they doing this step?" or "show me that part again," and the agent retrieves the right segment context quickly enough to keep the conversation natural. Moss describes its platform as real-time semantic search for conversational and multimodal AI, with retrieval designed to run close to the agent runtime. See the [Moss YC company page](https://www.ycombinator.com/companies/moss).

## Hackathon Sponsor Stack

Implemented sponsor technologies:

- **Moss**: semantic retrieval layer for procedure moments and dental knowledge.
- **LiveKit**: real-time voice room, browser audio session, Python agent dispatch, transcription stream, and data channel control messages.
- **MiniMax**: LLM and text-to-speech inside the Python LiveKit agent.

## Tech Stack

**Frontend and API**

- `Next.js 16` App Router with API routes under `app/api`.
- React 19 UI with dental video controls, timeline markers, voice orb, tutor panel, and visual knowledge cards.
- `@livekit/components-react` and `livekit-client` for the browser voice session.

**Voice agent**

- Python `livekit-agents` worker registered as `dental-coach`.
- LiveKit token route dispatches the agent into a room named after the active video/session.
- The agent receives video timestamps from the browser and sends playback commands back over the `video-control` data channel.
- MiniMax powers the agent LLM and TTS.

**Retrieval**

- Web tutor path uses Moss-backed indexes:
  - `dental_terminology`
  - `tooth_condition_images`
  - `procedure_moments`
- Python voice agent path uses the combined Moss index:
  - `dental_procedure`
- Local fallback retrieval is available in the web app when Moss credentials are not configured.

**Video preprocessing**

- `video_processing/dental_qwen_video.py` samples frames from a dental video and generates a structured teaching breakdown.
- `Speeden root canal 1.5.json` provides the current procedure segments and timestamps used by the UI and voice agent.
- `moss_docs/` contains dental knowledge documents synced into Moss.

## Getting Started

Install the web app dependencies:

```bash
npm install
```

Create local environment config from the example file:

```bash
cp .env.example .env
```

Fill the relevant values in `.env`. At minimum, full voice mode needs LiveKit, MiniMax, and Moss credentials. The web app can still run with local retrieval fallbacks if Moss is not configured.

Start the Next.js app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Set up the Python voice agent:

```powershell
cd agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Run the agent from the `agent` directory:

```bash
python main.py dev
```

Sync Moss documents for the Python agent from the repo root:

```powershell
cd ..
python agent\sync_moss.py
```

Sync Moss documents for the web tutor indexes:

```bash
curl -X POST http://localhost:3000/api/moss/sync
```

## Useful Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Build the production app |
| `npm run start` | Run the production server |
| `npm run lint` | Run ESLint |
| `python agent/sync_moss.py` | Sync `moss_docs/` into the Python agent Moss index |
| `python video_processing/dental_qwen_video.py --video path\to\video.mp4` | Generate structured dental video analysis JSON |


