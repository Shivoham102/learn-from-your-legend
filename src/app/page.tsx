"use client";

import { useState } from "react";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { VideoUpload } from "@/components/VideoUpload";
import { VoiceAgent } from "@/components/VoiceAgent";

export default function Home() {
  const [videoId, setVideoId] = useState<string | null>(null);
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
            Upload film. Ask why the play happened.
          </h1>
          <p className="max-w-2xl text-base text-zinc-600">
            A lightweight wrapper around sports video analysis and a voice coach.
            Upload a clip, let it process, and talk through specific plays while
            you wait — with a hook for sports-telegrams.dklhub context later.
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
