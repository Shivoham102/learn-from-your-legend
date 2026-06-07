import { saveVideo, updateVideo } from "./video-store";
import type { Play, ProcessingStage, VideoSession } from "./types";

const STAGES: ProcessingStage[] = [
  "queued",
  "transcoding",
  "detecting_plays",
  "indexing",
  "ready",
];

// TODO: replace with real frame analysis (Gemini Flash / GPT-4V over extracted frames)
// Each stub doc should also be upserted to Moss index `video_{videoId}` with
// metadata {type:"frame", t:timestampSec} so the voice agent can retrieve them.
const STUB_PLAYS: Play[] = [
  {
    id: "frame-1",
    timestampSec: 42,
    label: "Isolation and retraction",
    description:
      "Practitioner applies rubber dam and retractors to isolate the operative field before instrumentation.",
  },
  {
    id: "frame-2",
    timestampSec: 118,
    label: "Suction and debridement",
    description:
      "High-volume suction clears debris and irrigation fluid prior to the final preparation step.",
  },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createVideoSession(id: string, filename: string): VideoSession {
  const session: VideoSession = {
    id,
    filename,
    uploadedAt: new Date().toISOString(),
    status: "queued",
    progress: 0,
    plays: [],
  };

  saveVideo(session);
  void runProcessingPipeline(id);
  return session;
}

async function runProcessingPipeline(videoId: string): Promise<void> {
  for (let index = 0; index < STAGES.length; index += 1) {
    const status = STAGES[index];
    const progress = Math.round(((index + 1) / STAGES.length) * 100);

    updateVideo(videoId, {
      status,
      progress,
      plays: status === "ready" ? STUB_PLAYS : [],
    });

    if (status === "ready") return;
    await delay(2500);
  }
}
