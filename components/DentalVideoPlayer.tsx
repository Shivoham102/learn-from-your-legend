"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Video,
} from "lucide-react";
import { formatTimestamp } from "@/lib/uiActions";

export interface DentalVideoPlayerHandle {
  seekTo: (timestamp: number) => void;
  getCurrentTime: () => number;
  rewind: (seconds?: number) => void;
  forward: (seconds?: number) => void;
  /** Raw element so the video-control adapter can drive it directly. */
  getVideoElement: () => HTMLVideoElement | null;
}

interface DentalVideoPlayerProps {
  src?: string;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onPlay?: () => void;
}

const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5] as const;

const DentalVideoPlayer = forwardRef<
  DentalVideoPlayerHandle,
  DentalVideoPlayerProps
>(function DentalVideoPlayer(
  { src = "/videos/dental-procedure-demo.mp4", onTimeUpdate, onDurationChange, onPlay },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(420);
  const [hasError, setHasError] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const applyTime = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(duration, time));
      if (videoRef.current) {
        videoRef.current.currentTime = clamped;
      }
      setCurrentTime(clamped);
      onTimeUpdate?.(clamped);
      return clamped;
    },
    [duration, onTimeUpdate]
  );

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (timestamp: number) => {
        applyTime(timestamp);
      },
      getCurrentTime: () =>
        videoRef.current?.currentTime ?? currentTime,
      rewind: (seconds = 10) => {
        const base = videoRef.current?.currentTime ?? currentTime;
        applyTime(base - seconds);
      },
      forward: (seconds = 10) => {
        const base = videoRef.current?.currentTime ?? currentTime;
        applyTime(base + seconds);
      },
      getVideoElement: () => videoRef.current,
    }),
    [applyTime, currentTime]
  );

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => setHasError(true));
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    applyTime(parseFloat(e.target.value));
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;

    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Fullscreen may be blocked by browser policy
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  return (
    <div
      ref={containerRef}
      className="card-shadow group relative overflow-hidden rounded-2xl border border-[#E6ECEF] bg-white"
    >
      <div className="relative aspect-video w-full bg-[#F6F2EE]">
        {hasError ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[#E6ECEF] bg-[#EAF4FF]">
              <Video className="h-10 w-10 text-[#4A90E2]" strokeWidth={1.5} />
            </div>
            <p className="text-center text-sm text-[#667085]">
              Place video at{" "}
              <code className="rounded-md bg-[#F7FAF9] px-2 py-0.5 text-[#4A90E2]">
                {src}
              </code>
            </p>
            <p className="text-xs text-[#667085]">
              Simulated procedure timeline active — seek &amp; markers still work
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            src={src}
            onTimeUpdate={() => {
              const t = videoRef.current?.currentTime ?? 0;
              setCurrentTime(t);
              onTimeUpdate?.(t);
            }}
            onLoadedMetadata={() => {
              const d = videoRef.current?.duration ?? 420;
              setDuration(d);
              onDurationChange?.(d);
              if (videoRef.current) {
                videoRef.current.playbackRate = playbackSpeed;
              }
            }}
            onPlay={() => {
              console.log("[video] play");
              setIsPlaying(true);
              onPlay?.();
            }}
            onPause={() => setIsPlaying(false)}
            onError={() => setHasError(true)}
          />
        )}

        {/* Controls overlay */}
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#1F2933]/50 via-[#1F2933]/20 to-transparent px-4 pb-4 pt-10">
          <div className="rounded-xl border border-white/30 bg-white/90 px-3 py-3 shadow-lg backdrop-blur-md">
            {/* Progress bar */}
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              aria-label="Video progress"
              className="mb-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#E6ECEF] accent-[#2DB6A3] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2DB6A3] [&::-webkit-slider-thumb]:shadow-sm"
            />

            <div className="flex flex-wrap items-center gap-2">
              {/* Play / pause */}
              <button
                type="button"
                onClick={togglePlay}
                disabled={hasError}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2DB6A3] text-white transition hover:bg-[#259688] disabled:opacity-40"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" fill="currentColor" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                )}
              </button>

              {/* Rewind 10s */}
              <button
                type="button"
                onClick={() => applyTime(currentTime - 10)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F7FAF9] text-[#1F2933] transition hover:bg-[#EAF4FF]"
                aria-label="Rewind 10 seconds"
                title="Rewind 10 seconds"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={2} />
              </button>

              {/* Forward 10s */}
              <button
                type="button"
                onClick={() => applyTime(currentTime + 10)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F7FAF9] text-[#1F2933] transition hover:bg-[#EAF4FF]"
                aria-label="Forward 10 seconds"
                title="Forward 10 seconds"
              >
                <RotateCw className="h-4 w-4" strokeWidth={2} />
              </button>

              {/* Time display */}
              <span className="shrink-0 font-mono text-xs text-[#1F2933]">
                {formatTimestamp(currentTime)}
                <span className="text-[#667085]"> / </span>
                {formatTimestamp(duration)}
              </span>

              <div className="flex-1" />

              {/* Playback speed */}
              <div
                className="flex shrink-0 items-center gap-1 rounded-lg bg-[#F7FAF9] p-1"
                role="group"
                aria-label="Playback speed"
              >
                {PLAYBACK_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => handleSpeedChange(speed)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                      playbackSpeed === speed
                        ? "bg-[#2DB6A3] text-white"
                        : "text-[#667085] hover:bg-[#EAF4FF] hover:text-[#1F2933]"
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>

              {/* Fullscreen */}
              <button
                type="button"
                onClick={toggleFullscreen}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F7FAF9] text-[#1F2933] transition hover:bg-[#EAF4FF]"
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? (
                  <Minimize className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <Maximize className="h-4 w-4" strokeWidth={2} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute left-4 top-4 z-20">
        <span className="flex items-center gap-1.5 rounded-full border border-[#E6ECEF] bg-white/95 px-3 py-1 text-xs font-medium text-[#667085] shadow-sm backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[#2DB6A3]" />
          Procedure Recording
        </span>
      </div>
    </div>
  );
});

export default DentalVideoPlayer;
