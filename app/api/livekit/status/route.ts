import { NextResponse } from "next/server";
import { isLiveKitConfigured } from "@/lib/livekit";

export async function GET() {
  const configured = isLiveKitConfigured();

  return NextResponse.json({
    configured,
    url: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? null,
    source: configured ? "livekit" : "mock",
    message: configured
      ? "LiveKit credentials configured"
      : "Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and NEXT_PUBLIC_LIVEKIT_URL in .env.local",
  });
}
