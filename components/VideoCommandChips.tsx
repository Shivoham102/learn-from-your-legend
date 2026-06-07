"use client";

interface VideoCommandChipsProps {
  onChipClick: (command: string) => void;
}

const COMMANDS = [
  "Why did she drill here?",
  "Show stage 3 vs 4",
  "Rewind 10s",
  "What is dentin?",
  "What happens if deeper?",
] as const;

export default function VideoCommandChips({
  onChipClick,
}: VideoCommandChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {COMMANDS.map((command) => (
        <button
          key={command}
          type="button"
          onClick={() => onChipClick(command)}
          className="rounded-full border border-[#E6ECEF] bg-white px-3.5 py-1.5 text-xs font-medium text-[#1F2933] card-shadow transition hover:border-[#4A90E2]/40 hover:bg-[#EAF4FF] hover:text-[#4A90E2] active:scale-[0.98]"
        >
          {command}
        </button>
      ))}
    </div>
  );
}
