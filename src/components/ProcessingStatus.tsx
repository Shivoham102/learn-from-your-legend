"use client";

import { useEffect, useState } from "react";
import type { VideoSession } from "@/lib/types";

type ProcessingStatusProps = {
  videoId: string;
  filename: string;
};

const STAGE_LABELS: Record<VideoSession["status"], string> = {
  queued: "Queued",
  transcoding: "Transcoding",
  detecting_plays: "Detecting plays",
  indexing: "Indexing moments",
  ready: "Ready",
  failed: "Failed",
};

export function ProcessingStatus({ videoId, filename }: ProcessingStatusProps) {
  const [session, setSession] = useState<VideoSession | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const response = await fetch(`/api/videos/${videoId}`);
      if (!response.ok || cancelled) return;

      const payload = (await response.json()) as VideoSession;
      setSession(payload);

      if (payload.status !== "ready" && payload.status !== "failed") {
        window.setTimeout(poll, 1500);
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const progress = session?.progress ?? 0;
  const status = session?.status ?? "queued";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Processing</h2>
          <p className="mt-1 text-sm text-zinc-600">{filename}</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
          {STAGE_LABELS[status]}
        </span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {session?.plays.length ? (
        <ul className="mt-4 space-y-2 text-sm text-zinc-700">
          {session.plays.map((play) => (
            <li key={play.id} className="rounded-lg bg-zinc-50 px-3 py-2">
              <span className="font-medium">{play.label}</span> at{" "}
              {play.timestampSec}s — {play.description}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          Plays will appear here once detection finishes. Chat with the voice
          agent in the meantime.
        </p>
      )}
    </section>
  );
}
