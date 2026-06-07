"use client";

import { BarChart3, X } from "lucide-react";
import { getToothStageById } from "@/lib/sampleData";
import KnowledgeCard from "./KnowledgeCard";

interface ToothStageComparisonProps {
  stageIds: string[];
  onClose?: () => void;
}

export default function ToothStageComparison({
  stageIds,
  onClose,
}: ToothStageComparisonProps) {
  const stages = stageIds
    .map((id) => getToothStageById(id))
    .filter(Boolean);

  if (stages.length === 0) return null;

  return (
    <div className="relative rounded-2xl border border-[#E6ECEF] bg-white p-4 card-shadow">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-[#F7FAF9] text-[#667085] transition hover:text-[#1F2933]"
          aria-label="Close comparison"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      )}

      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#DDF5EF]">
          <BarChart3 className="h-4 w-4 text-[#2DB6A3]" strokeWidth={2} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#1F2933]">
            Tooth Stage Comparison
          </h3>
          <p className="text-xs text-[#667085]">Side-by-side decay progression</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {stages.map((stage) => (
          <KnowledgeCard
            key={stage!.id}
            title={stage!.name}
            description={stage!.description}
            imageUrl={stage!.image_url}
            category={`Stage ${stage!.stage}`}
            tags={stage!.characteristics}
          />
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-[#E6ECEF] bg-[#F7FAF9] p-3">
        <p className="text-xs leading-relaxed text-[#667085]">
          <span className="font-medium text-[#2DB6A3]">Clinical insight: </span>
          Stage 3 decay allows selective removal — Stage 4 approaches pulp exposure
          and requires more conservative excavation techniques.
        </p>
      </div>
    </div>
  );
}
