import { getVideo } from "./video-store";
import type { VideoSession } from "./types";

export function buildVoiceReply(videoId: string, question: string): string {
  const video = getVideo(videoId);
  if (!video) {
    return "I don't have an active session for that video yet. Upload one to get started.";
  }

  const normalized = question.toLowerCase();

  if (video.status !== "ready") {
    return [
      `Your video is still processing (${video.status}, ${video.progress}%).`,
      "I can still talk through what to look for — mention a timestamp or describe the play.",
      "Once indexing finishes, I'll tie answers to detected plays automatically.",
    ].join(" ");
  }

  const matchedPlay = video.plays.find(
    (play) =>
      normalized.includes(play.label.toLowerCase()) ||
      normalized.includes(String(play.timestampSec)),
  );

  if (matchedPlay) {
    return [
      `At ${matchedPlay.timestampSec}s (${matchedPlay.label}):`,
      matchedPlay.description,
      "Ask about another timestamp or play type if you want to go deeper.",
    ].join(" ");
  }

  if (normalized.includes("why") || normalized.includes("reason")) {
    return [
      "Good question. Start with the trigger: what forced the defense to rotate?",
      `I found ${video.plays.length} indexed plays — try asking about one by name or timestamp.`,
    ].join(" ");
  }

  return [
    "I'm your play-by-play coach for this upload.",
    "Ask about a specific moment (e.g. 'what happened at 0:42?' or 'explain the pick and roll').",
    sportsTelegramHint(),
  ].join(" ");
}

function sportsTelegramHint(): string {
  const hub = process.env.SPORTS_TELEGRAMS_DKLHUB_URL;
  if (!hub) {
    return "Wire up sports-telegrams.dklhub when you're ready for richer play context.";
  }
  return `Pulling supplemental context from ${hub}.`;
}

export function getVideoContextSummary(video: VideoSession): string {
  if (video.plays.length === 0) {
    return "No plays indexed yet.";
  }

  return video.plays
    .map((play) => `${play.timestampSec}s — ${play.label}`)
    .join("; ");
}
