export type ProcessingStage =
  | "queued"
  | "transcoding"
  | "detecting_plays"
  | "indexing"
  | "ready"
  | "failed";

export type Play = {
  id: string;
  timestampSec: number;
  label: string;
  description: string;
};

export type VideoSession = {
  id: string;
  filename: string;
  uploadedAt: string;
  status: ProcessingStage;
  progress: number;
  plays: Play[];
  error?: string;
};

export type VoiceMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export type VoiceSession = {
  videoId: string;
  messages: VoiceMessage[];
};
