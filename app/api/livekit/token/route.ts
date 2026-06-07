import { NextRequest, NextResponse } from "next/server";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import { getLiveKitConfig, isLiveKitConfigured } from "@/lib/livekit";

export { isLiveKitConfigured };

async function generateToken(roomName: string, participantName: string) {
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
    return { token: mockToken, serverUrl: url || "wss://mock.livekit.local", url: url || "wss://mock.livekit.local", mock: true };
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    name: participantName,
    ttl: "1h",
  });
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  const jwt = await at.toJwt();

  // Dispatch the agent — fire-and-forget, idempotent check prevents duplicates
  const httpUrl = url.replace(/^wss?:\/\//, "https://");
  const dispatchClient = new AgentDispatchClient(httpUrl, apiKey, apiSecret);
  dispatchClient.listDispatch(roomName).then((existing) => {
    if (existing.some((d) => d.agentName === "dental-coach")) return;
    return dispatchClient.createDispatch(roomName, "dental-coach");
  }).catch(() => {});

  return { token: jwt, serverUrl: url, url, mock: false, roomName, participantName };
}

// GET — used by VoiceAgent.tsx: /api/livekit/token?videoId=X&identity=Y
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const roomName = searchParams.get("videoId") ?? "dental-tutor-room";
    const participantName = searchParams.get("identity") ?? "user";
    return NextResponse.json(await generateToken(roomName, participantName));
  } catch (error) {
    console.error("[/api/livekit/token GET]", error);
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { roomName = "dental-tutor-room", participantName = "student" } =
      await request.json();
    return NextResponse.json(await generateToken(roomName, participantName));
  } catch (error) {
    console.error("[/api/livekit/token POST]", error);
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}
