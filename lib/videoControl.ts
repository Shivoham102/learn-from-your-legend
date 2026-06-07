/**
 * Video control adapter.
 *
 * Translates voice-agent tool calls into direct operations on the underlying
 * HTML <video> element (video.play(), video.pause(), video.currentTime). It is
 * intentionally framework-free so it can be unit-tested against a mock element.
 *
 * The LiveKit agent publishes a JSON command on the "video-control" data topic;
 * the frontend decodes it (parseVideoCommand) and dispatches it (handleCommand).
 */

export const VIDEO_CONTROL_TOPIC = "video-control";

/** Default jump size, in seconds, for rewind/forward when none is supplied. */
export const DEFAULT_STEP_SECONDS = 10;

export type VideoCommand =
  | { action: "play" }
  | { action: "pause" }
  | { action: "rewind"; seconds?: number }
  | { action: "forward"; seconds?: number }
  | { action: "seek"; timestamp: number };

export interface VideoController {
  playVideo(): void;
  pauseVideo(): void;
  rewindVideo(seconds?: number): void;
  forwardVideo(seconds?: number): void;
  seekVideo(timestamp: number): void;
  /** Dispatch a structured command (e.g. one received from the agent). */
  handleCommand(command: VideoCommand): void;
}

function log(message: string, ...details: unknown[]): void {
  // Simple, greppable logging so each triggered tool call is easy to verify.
  console.log(`[VideoControl] ${message}`, ...details);
}

/**
 * Create a controller bound to a lazily-resolved <video> element. The getter is
 * called on every operation so the controller keeps working even if the element
 * is remounted (e.g. React re-render).
 */
export function createVideoController(
  getVideo: () => HTMLVideoElement | null
): VideoController {
  function clampTime(video: HTMLVideoElement, time: number): number {
    const max = Number.isFinite(video.duration) ? video.duration : time;
    return Math.max(0, Math.min(max, time));
  }

  function withVideo(action: string, fn: (video: HTMLVideoElement) => void): void {
    const video = getVideo();
    if (!video) {
      log(`${action} ignored — no video element available`);
      return;
    }
    fn(video);
  }

  const controller: VideoController = {
    playVideo() {
      withVideo("playVideo", (video) => {
        log("play");
        void video.play().catch((err) => log("play() rejected", err));
      });
    },

    pauseVideo() {
      withVideo("pauseVideo", (video) => {
        log("pause");
        video.pause();
      });
    },

    rewindVideo(seconds = DEFAULT_STEP_SECONDS) {
      withVideo("rewindVideo", (video) => {
        const target = clampTime(video, video.currentTime - seconds);
        log(`rewind ${seconds}s`, { from: video.currentTime, to: target });
        video.currentTime = target;
      });
    },

    forwardVideo(seconds = DEFAULT_STEP_SECONDS) {
      withVideo("forwardVideo", (video) => {
        const target = clampTime(video, video.currentTime + seconds);
        log(`forward ${seconds}s`, { from: video.currentTime, to: target });
        video.currentTime = target;
      });
    },

    seekVideo(timestamp: number) {
      withVideo("seekVideo", (video) => {
        const target = clampTime(video, timestamp);
        log("seek", { to: target });
        video.currentTime = target;
      });
    },

    handleCommand(command: VideoCommand) {
      switch (command.action) {
        case "play":
          controller.playVideo();
          break;
        case "pause":
          controller.pauseVideo();
          break;
        case "rewind":
          controller.rewindVideo(command.seconds);
          break;
        case "forward":
          controller.forwardVideo(command.seconds);
          break;
        case "seek":
          controller.seekVideo(command.timestamp);
          break;
      }
    },
  };

  return controller;
}

/**
 * Decode and validate a command from a LiveKit data payload (Uint8Array) or a
 * raw JSON string. Returns null for anything malformed so callers can ignore it.
 */
export function parseVideoCommand(
  raw: Uint8Array | string
): VideoCommand | null {
  let text: string;
  try {
    text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  } catch {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    log("ignored non-JSON payload", text);
    return null;
  }

  if (!data || typeof data !== "object" || !("action" in data)) return null;
  const obj = data as Record<string, unknown>;

  switch (obj.action) {
    case "play":
      return { action: "play" };
    case "pause":
      return { action: "pause" };
    case "rewind":
      return {
        action: "rewind",
        seconds: typeof obj.seconds === "number" ? obj.seconds : undefined,
      };
    case "forward":
      return {
        action: "forward",
        seconds: typeof obj.seconds === "number" ? obj.seconds : undefined,
      };
    case "seek":
      if (typeof obj.timestamp !== "number") return null;
      return { action: "seek", timestamp: obj.timestamp };
    default:
      log("ignored unknown action", obj.action);
      return null;
  }
}
