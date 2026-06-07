"use client";

import type { ProcedureSegment } from "@/lib/procedureData";

interface VideoCommandChipsProps {
  segment: ProcedureSegment | null;
  onChipClick: (question: string) => void;
}

function generateQuestions(seg: ProcedureSegment): string[] {
  const instrument = seg.instruments.find((i) => i.trim() !== "");
  const anat = seg.anatomy.find((a) => a.trim() !== "");

  const q1 = instrument
    ? `Why is a ${instrument} used here?`
    : `Why is the ${seg.phase} phase done at this point?`;

  const q2 = anat
    ? `What is the role of the ${anat} in this step?`
    : `What could damage nearby tissue during this step?`;

  const q3 = `What happens if ${seg.step_name.toLowerCase()} is rushed or skipped?`;

  return [q1, q2, q3];
}

export default function VideoCommandChips({
  segment,
  onChipClick,
}: VideoCommandChipsProps) {
  return (
    <div key={segment?.id ?? "loading"} className="flex flex-wrap gap-2 animate-in">
      {segment === null ? (
        <>
          <div className="h-[30px] w-36 animate-pulse rounded-full bg-gray-100" />
          <div className="h-[30px] w-44 animate-pulse rounded-full bg-gray-100" />
          <div className="h-[30px] w-40 animate-pulse rounded-full bg-gray-100" />
        </>
      ) : (
        generateQuestions(segment).map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onChipClick(q)}
            className="rounded-full border border-[#E6ECEF] bg-white px-3.5 py-1.5 text-xs font-medium text-[#1F2933] card-shadow transition hover:border-[#4A90E2]/40 hover:bg-[#EAF4FF] hover:text-[#4A90E2] active:scale-[0.98]"
          >
            {q}
          </button>
        ))
      )}
    </div>
  );
}
