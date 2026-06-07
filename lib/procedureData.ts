import type { TimelineMarker } from "@/types/dental";
import rawProcedure from "@/Speeden root canal 1.5.json";

/** A single procedure segment as authored in the source JSON (timestamps "MM:SS"). */
export interface ProcedureSegment {
  id: string;
  start: string;
  end: string;
  phase: string;
  step_name: string;
  context: string;
  instruments: string[];
  anatomy: string[];
  materials: string[];
  key_moment: string;
}

interface ProcedureData {
  procedure: string;
  total_duration: string;
  segments: ProcedureSegment[];
}

const data = rawProcedure as ProcedureData;

/** Convert a "MM:SS" timestamp to absolute seconds. */
export function mmSsToSeconds(ts: string): number {
  const [m, s] = ts.split(":").map(Number);
  if (Number.isNaN(m) || Number.isNaN(s)) return 0;
  return m * 60 + s;
}

export const PROCEDURE_NAME = data.procedure;
export const PROCEDURE_SEGMENTS = data.segments;
export const PROCEDURE_DURATION = mmSsToSeconds(data.total_duration);

/** Timeline markers derived from the JSON segments — one marker per segment start. */
export const PROCEDURE_TIMELINE_MARKERS: TimelineMarker[] = data.segments.map(
  (seg) => ({
    id: seg.id,
    timestamp: mmSsToSeconds(seg.start),
    label: seg.step_name,
    step_id: seg.id,
  })
);

/** Find the segment covering a given time (seconds); falls back to the last segment. */
export function findSegmentByTime(timeSeconds: number): ProcedureSegment | undefined {
  let last: ProcedureSegment | undefined;
  for (const seg of data.segments) {
    const start = mmSsToSeconds(seg.start);
    const end = mmSsToSeconds(seg.end);
    if (timeSeconds >= start && timeSeconds < end) return seg;
    if (timeSeconds >= start) last = seg;
  }
  return last;
}
