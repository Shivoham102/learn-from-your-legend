import { NextRequest, NextResponse } from "next/server";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import { getLiveKitConfig, isLiveKitConfigured } from "@/lib/livekit";

export { isLiveKitConfigured };

// Fast-path dedup: StrictMode fires useEffect twice in ~1ms — both requests arrive
// before the agent joins, so the participant check below can't catch them.
// This map blocks the second request synchronously.
const lastDispatchedAt = new Map<string, number>();
const DISPATCH_DEDUP_MS = 3_000;

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

  // Dispatch agent — fire-and-forget, double-dispatch guarded by two layers:
  // 1. Timestamp dedup (synchronous): blocks StrictMode near-simultaneous requests
  // 2. Participant check (async): skips dispatch if agent already alive in room
  const httpUrl = url.replace(/^wss?:\/\//, "https://");
  const now = Date.now();
  const last = lastDispatchedAt.get(roomName) ?? 0;
  if (now - last <= DISPATCH_DEDUP_MS) {
    console.log(`[dispatch] dedup skip (${now - last}ms ago)`);
  } else {
    lastDispatchedAt.set(roomName, now);
    const dispatchClient = new AgentDispatchClient(httpUrl, apiKey, apiSecret);
    const roomSvc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
    roomSvc
      .listParticipants(roomName)
      .then((participants) => {
        // ParticipantInfo_Kind.AGENT === 4 in LiveKit proto (2 is EGRESS)
        const hasAgent = participants.some((p) => (p as { kind?: number }).kind === 4);
        console.log(`[dispatch] room=${roomName} participants=${participants.length} hasAgent=${hasAgent}`);
        if (hasAgent) return;
        return dispatchClient
          .createDispatch(roomName, "dental-coach")
          .then((d) => console.log("[dispatch] created:", d.agentName));
      })
      .catch(() => {
        // Room doesn't exist yet — dispatch unconditionally
        console.log("[dispatch] new room, dispatching");
        dispatchClient.createDispatch(roomName, "dental-coach")
          .then((d) => console.log("[dispatch] created:", d.agentName))
          .catch((err: unknown) =>
            console.error("[dispatch] failed:", err instanceof Error ? err.message : err),
          );
      });
  }

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
