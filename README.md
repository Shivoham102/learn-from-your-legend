# Learn From Your Legend

A starter wrapper for learning from sports film. Users upload a video, processing runs in the background, and a voice agent answers questions about specific plays while they wait.

## What this skeleton includes

- **Video upload** — `POST /api/upload` stores files under `uploads/` and kicks off a stub pipeline
- **Processing status** — `GET /api/videos/:id` polls staged progress (transcode → detect plays → index)
- **Voice agent** — `POST /api/voice` returns coaching-style answers; mic button is a placeholder
- **sports-telegrams.dklhub hook** — `src/lib/sports-telegram.ts` is ready for real hub integration

## Quick start

```bash
npm install
cp .env.example .env.local   # optional
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), upload a clip, and ask questions like “what happened at 0:42?” or “explain the pick and roll.”

## Project layout

```
src/
├── app/
│   ├── api/
│   │   ├── upload/route.ts      # accept video uploads
│   │   ├── videos/[id]/route.ts # processing status
│   │   └── voice/route.ts       # voice agent messages
│   └── page.tsx                 # main UI
├── components/
│   ├── VideoUpload.tsx
│   ├── ProcessingStatus.tsx
│   └── VoiceAgent.tsx
└── lib/
    ├── types.ts
    ├── video-store.ts           # in-memory session store (swap for DB)
    ├── video-processor.ts       # stub async pipeline
    ├── voice-agent.ts           # stub coaching replies
    └── sports-telegram.ts       # dklhub integration placeholder
```

## Next steps

1. Replace the in-memory store with Postgres or Redis
2. Wire real video analysis (ffmpeg, CV models, or a worker queue)
3. Connect `sports-telegram.ts` to sports-telegrams.dklhub
4. Swap the text chat stub for a voice provider (WebRTC, OpenAI Realtime, ElevenLabs, etc.)
5. Add auth and per-user session history

## Scripts

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Start dev server         |
| `npm run build`| Production build         |
| `npm run start`| Run production server    |
| `npm run lint` | ESLint                   |
