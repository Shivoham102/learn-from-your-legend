import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { getLiveKitConfig, isLiveKitConfigured } from "@/lib/livekit";

export { isLiveKitConfigured };

export async function POST(request: NextRequest) {
  try {
    const { roomName = "dental-tutor-room", participantName = "student" } =
      await request.json();

    const { apiKey, apiSecret, url } = getLiveKitConfig();

    if (!isLiveKitConfigured()) {
      const mockToken = Buffer.from(
        JSON.stringify({
          room: roomName,
          identity: participantName,
          exp: Date.now() + 3600000,
          mock: true,
        })
      ).toString("base64");

      return NextResponse.json({
        token: mockToken,
        url: url || "wss://mock.livekit.local",
        mock: true,
        message:
          "Mock token returned. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and NEXT_PUBLIC_LIVEKIT_URL in .env.local",
      });
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
      name: participantName,
      ttl: "1h",
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const jwt = await token.toJwt();

    return NextResponse.json({
      token: jwt,
      url,
      mock: false,
      roomName,
      participantName,
    });
  } catch (error) {
    console.error("[/api/livekit/token]", error);
    return NextResponse.json(
      { error: "Failed to generate LiveKit token" },
      { status: 500 }
    );
  }
}
