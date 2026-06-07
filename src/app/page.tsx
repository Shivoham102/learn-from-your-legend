"use client";

import { useState } from "react";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { VideoUpload } from "@/components/VideoUpload";
import { VoiceAgent } from "@/components/VoiceAgent";

export default function Home() {
  // TODO: remove hardcoded videoId after upload flow is tested
  const [videoId, setVideoId] = useState<string | null>("test-room-1");
  const [filename, setFilename] = useState<string | null>(null);

  function handleUploaded(id: string, name: string) {
    setVideoId(id);
    setFilename(name);
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-700">
            Learn from your legend
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Upload a procedure. Ask why each action was taken.
          </h1>
          <p className="max-w-2xl text-base text-zinc-600">
            Upload a dental or medical procedure film. While it processes, talk
            with a voice agent about your learning goals. Once ready, ask about
            any specific moment or technique in the video.
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <VideoUpload onUploaded={handleUploaded} />
          {videoId && filename ? (
            <ProcessingStatus videoId={videoId} filename={filename} />
          ) : null}
        </div>

        <VoiceAgent videoId={videoId} />
      </main>
    </div>
  );
}
