"use client";

import { useState } from "react";

type UploadResponse = {
  videoId: string;
  filename: string;
  status: string;
  progress: number;
};

type VideoUploadProps = {
  onUploaded: (videoId: string, filename: string) => void;
};

export function VideoUpload({ onUploaded }: VideoUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("video", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Upload failed.");
      }

      const payload = (await response.json()) as UploadResponse;
      onUploaded(payload.videoId, payload.filename);
      setFile(null);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
    >
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Upload game film</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Drop a clip while processing runs. You can ask about specific plays
          right away.
        </p>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40">
        <span className="text-sm font-medium text-zinc-700">
          {file ? file.name : "Choose a video file"}
        </span>
        <span className="text-xs text-zinc-500">MP4, MOV, or WebM</span>
        <input
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={!file || uploading}
        className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {uploading ? "Uploading..." : "Upload and start session"}
      </button>
    </form>
  );
}
