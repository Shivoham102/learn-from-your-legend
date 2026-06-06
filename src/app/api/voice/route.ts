import { NextResponse } from "next/server";
import { appendVoiceMessage } from "@/lib/video-store";
import { buildVoiceReply } from "@/lib/voice-agent";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    videoId?: string;
    message?: string;
  };

  if (!body.videoId || !body.message?.trim()) {
    return NextResponse.json(
      { error: "videoId and message are required." },
      { status: 400 },
    );
  }

  const timestamp = new Date().toISOString();
  appendVoiceMessage(body.videoId, {
    role: "user",
    content: body.message.trim(),
    timestamp,
  });

  const reply = buildVoiceReply(body.videoId, body.message);
  appendVoiceMessage(body.videoId, {
    role: "assistant",
    content: reply,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({ reply });
}
