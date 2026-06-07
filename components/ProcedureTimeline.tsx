"use client";

import { useState } from "react";
import {
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  ChevronUp,
  Clock,
} from "lucide-react";
import { formatTimestamp } from "@/lib/uiActions";
import type { TimelineMarker } from "@/types/dental";

interface ProcedureTimelineProps {
  markers: TimelineMarker[];
  currentTime: number;
  duration: number;
  activeStepId?: string;
  onSeek: (timestamp: number) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function ProcedureTimeline({
  markers,
  currentTime,
  duration,
  activeStepId,
  onSeek,
  isOpen: controlledIsOpen,
  onOpenChange,
}: ProcedureTimelineProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen ?? internalIsOpen;

  const setIsOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    } else {
      setInternalIsOpen(open);
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-full max-w-3xl -translate-x-1/2 flex-col items-center px-4">
      {isOpen && (
        <div
          className="timeline-panel-enter pointer-events-auto mb-3 w-full origin-bottom"
          role="region"
          aria-label="Procedure timeline"
        >
          <div className="card-shadow rounded-2xl border border-[#E6ECEF] bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#DDF5EF]">
                  <ChartNoAxesColumnIncreasing
                    className="h-4 w-4 text-[#2DB6A3]"
                    strokeWidth={2}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#1F2933]">
                    Procedure Timeline
                  </h3>
                  <p className="text-xs text-[#667085]">
                    Jump to key clinical moments
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-[#F7FAF9] px-3 py-1.5">
                <Clock className="h-3.5 w-3.5 text-[#667085]" strokeWidth={2} />
                <span className="font-mono text-xs font-medium text-[#2DB6A3]">
                  {formatTimestamp(currentTime)}
                </span>
                <span className="text-xs text-[#667085]">/</span>
                <span className="font-mono text-xs text-[#667085]">
                  {formatTimestamp(duration)}
                </span>
              </div>
            </div>

            <div className="relative mb-5 h-2 rounded-full bg-[#F6F2EE]">
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-[#2DB6A3] transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
              {markers.map((marker) => {
                const position =
                  duration > 0 ? (marker.timestamp / duration) * 100 : 0;
                const isActive = activeStepId === marker.step_id;
                const isPast = currentTime >= marker.timestamp;

                return (
                  <button
                    key={marker.id}
                    onClick={() => onSeek(marker.timestamp)}
                    className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${position}%` }}
                    title={marker.label}
                    aria-label={`Seek to ${marker.label}`}
                  >
                    <span
                      className={`block h-3.5 w-3.5 rounded-full border-2 transition-all duration-200 ${
                        isActive
                          ? "scale-125 border-[#2DB6A3] bg-[#2DB6A3] shadow-md shadow-[#2DB6A3]/30"
                          : isPast
                            ? "border-[#2DB6A3]/70 bg-[#DDF5EF]"
                            : "border-[#E6ECEF] bg-white group-hover:border-[#4A90E2] group-hover:bg-[#EAF4FF]"
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {markers.map((marker) => {
                const isActive = activeStepId === marker.step_id;
                return (
                  <button
                    key={marker.id}
                    onClick={() => onSeek(marker.timestamp)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${
                      isActive
                        ? "border-[#2DB6A3]/40 bg-[#DDF5EF] text-[#1F2933]"
                        : "border-[#E6ECEF] bg-[#F7FAF9] text-[#667085] hover:border-[#4A90E2]/30 hover:bg-[#EAF4FF]"
                    }`}
                  >
                    <span className="block font-mono text-[10px] text-[#667085]">
                      {formatTimestamp(marker.timestamp)}
                    </span>
                    <span className="mt-0.5 block text-xs font-medium leading-tight text-[#1F2933]">
                      {marker.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={isOpen ? "Hide timeline" : "Show procedure timeline"}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Hide timeline" : "Show procedure timeline"}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-[#E6ECEF] bg-white px-4 py-2.5 text-sm font-medium text-[#1F2933] card-shadow transition-all duration-200 hover:border-[#4A90E2]/40 hover:bg-[#F7FAF9] active:scale-[0.98]"
      >
        {isOpen ? (
          <>
            <ChevronDown className="h-4 w-4 text-[#667085]" strokeWidth={2} />
            <span>Hide timeline</span>
          </>
        ) : (
          <>
            <ChartNoAxesColumnIncreasing
              className="h-4 w-4 text-[#2DB6A3]"
              strokeWidth={2}
            />
            <span>Show procedure timeline</span>
            <ChevronUp className="h-4 w-4 text-[#667085]" strokeWidth={2} />
          </>
        )}
      </button>
    </div>
  );
}
