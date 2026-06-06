import type { VideoSession, VoiceSession } from "./types";

const videos = new Map<string, VideoSession>();
const voiceSessions = new Map<string, VoiceSession>();

export function saveVideo(session: VideoSession): void {
  videos.set(session.id, session);
}

export function getVideo(id: string): VideoSession | undefined {
  return videos.get(id);
}

export function updateVideo(
  id: string,
  patch: Partial<VideoSession>,
): VideoSession | undefined {
  const current = videos.get(id);
  if (!current) return undefined;

  const updated = { ...current, ...patch };
  videos.set(id, updated);
  return updated;
}

export function getOrCreateVoiceSession(videoId: string): VoiceSession {
  const existing = voiceSessions.get(videoId);
  if (existing) return existing;

  const session: VoiceSession = { videoId, messages: [] };
  voiceSessions.set(videoId, session);
  return session;
}

export function appendVoiceMessage(
  videoId: string,
  message: VoiceSession["messages"][number],
): VoiceSession {
  const session = getOrCreateVoiceSession(videoId);
  session.messages.push(message);
  voiceSessions.set(videoId, session);
  return session;
}
