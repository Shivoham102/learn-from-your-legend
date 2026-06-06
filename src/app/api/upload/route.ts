import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { createVideoSession } from "@/lib/video-processor";

export const runtime = "nodejs";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing video file in form field 'video'." },
      { status: 400 },
    );
  }

  const videoId = randomUUID();
  await mkdir(UPLOAD_DIR, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const storedPath = path.join(UPLOAD_DIR, `${videoId}-${safeName}`);
  await writeFile(storedPath, buffer);

  const session = createVideoSession(videoId, file.name);

  return NextResponse.json({
    videoId: session.id,
    filename: session.filename,
    status: session.status,
    progress: session.progress,
  });
}
