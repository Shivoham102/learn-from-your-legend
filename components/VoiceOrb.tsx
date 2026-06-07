"use client";

export type VoiceOrbState = "listening" | "user-speaking" | "ai-speaking";

interface VoiceOrbProps {
  state?: VoiceOrbState;
  onClick?: () => void;
}

const BAR_COUNT = 36;

function barGradient(index: number): string {
  const t = index / (BAR_COUNT - 1);
  const top =
    t < 0.4 ? "#A8E4F5" : t < 0.7 ? "#7DBBFF" : "#B8AAFF";
  const bottom =
    t < 0.4 ? "#7DBBFF" : t < 0.7 ? "#8EA5FF" : "#C7B8FF";
  return `linear-gradient(to top, ${bottom}, ${top})`;
}

function barListeningHeight(index: number): number {
  const wave = Math.sin(index * 0.48) * 12 + Math.cos(index * 0.26) * 8;
  return 20 + wave;
}

function barUserHeight(index: number): number {
  const wave =
    Math.abs(Math.sin(index * 0.82)) * 30 + Math.cos(index * 0.38) * 16;
  return 26 + wave;
}

function barAiHeight(index: number): number {
  const wave = Math.sin(index * 0.36 + 0.6) * 18 + 24;
  return wave;
}

function statusLabel(state: VoiceOrbState, clickable: boolean): string {
  if (state === "ai-speaking") return "Explaining procedure…";
  if (state === "user-speaking") return "Listening… tap to stop";
  if (clickable) return "Tap to speak";
  return "I'm always listening";
}

export default function VoiceOrb({ state = "listening", onClick }: VoiceOrbProps) {
  const isUser = state === "user-speaking";
  const isAi = state === "ai-speaking";
  const isClickable = !!onClick;

  return (
    <div className="flex flex-col items-center gap-1.5 py-2">
      <div
        className={`voice-orb-stage relative flex h-14 w-full max-w-[380px] items-center justify-center sm:h-[72px] ${isClickable ? "cursor-pointer select-none" : ""}`}
        aria-label={isUser ? "Recording — click to stop" : isAi ? "Agent speaking" : "Click to speak"}
        role={isClickable ? "button" : "img"}
        onClick={onClick}
      >
        {/* Waveform bars — behind orb */}
        <div
          className="absolute inset-0 z-0 flex items-center justify-center gap-[3px] px-3 sm:gap-1 sm:px-5"
          aria-hidden="true"
        >
          {Array.from({ length: BAR_COUNT }).map((_, i) => {
            const baseHeight = isUser
              ? barUserHeight(i)
              : isAi
                ? barAiHeight(i)
                : barListeningHeight(i);

            const barClass = isUser
              ? "voice-orb-bar--active"
              : isAi
                ? "voice-orb-bar--pulse"
                : "voice-orb-bar--idle";

            return (
              <span
                key={i}
                className={`voice-orb-bar w-[5px] shrink-0 rounded-full sm:w-[6px] ${barClass}`}
                suppressHydrationWarning
                style={{
                  background: barGradient(i),
                  height: `${Math.round(baseHeight)}px`,
                  animationDelay: `${i * 0.045}s`,
                  opacity: isUser ? 0.94 : 0.82,
                }}
              />
            );
          })}
        </div>

        {/* User-speaking rings */}
        {isUser && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 z-[5] h-28 w-28 -translate-x-1/2 -translate-y-1/2 sm:h-32 sm:w-32"
            aria-hidden="true"
          >
            {[0, 1, 2, 3].map((ring) => (
              <span
                key={ring}
                className="voice-orb-ring absolute left-1/2 top-1/2 rounded-full border"
                style={{
                  width: 48 + ring * 20,
                  height: 48 + ring * 20,
                  animationDelay: `${ring * 0.38}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* Glass orb — centered on waveform */}
        <div
          className={`voice-orb-sphere-wrap absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 ${
            isUser
              ? "voice-orb-sphere-wrap--user"
              : isAi
                ? "voice-orb-sphere-wrap--ai"
                : "voice-orb-sphere-wrap--idle"
          }`}
        >
          <div className="voice-orb-sphere" aria-hidden="true" />
        </div>
      </div>

      <p className="text-xs font-medium text-[#1F2933]" aria-live="polite">
        {statusLabel(state, isClickable)}
      </p>
      <p className="text-[10px] text-[#667085]">Powered by Moss AI</p>
    </div>
  );
}
