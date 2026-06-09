import { NextRequest, NextResponse } from "next/server";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import { getLiveKitConfig, isLiveKitConfigured } from "@/lib/livekit";

export { isLiveKitConfigured };

const AGENT_NAME = "dental-coach-red-test-1111";
const DISPATCH_GUARD_MS = 15_000;
const dispatchGuards = new Map<string, { expiresAt: number; promise: Promise<void> }>();

function describeParticipants(participants: Awaited<ReturnType<RoomServiceClient["listParticipants"]>>) {
  return participants.map((p) => ({
    identity: p.identity,
    sid: p.sid,
    kind: (p as { kind?: number }).kind,
    state: (p as { state?: number }).state,
  }));
}

async function ensureAgentDispatched({
  roomName,
  httpUrl,
  apiKey,
  apiSecret,
}: {
  roomName: string;
  httpUrl: string;
  apiKey: string;
  apiSecret: string;
}) {
  const now = Date.now();
  const guard = dispatchGuards.get(roomName);
  if (guard && guard.expiresAt > now) {
    console.log("[dispatch] skipped — room dispatch guard active", {
      roomName,
      remainingMs: guard.expiresAt - now,
    });
    return guard.promise;
  }

  const promise = (async () => {
    const dispatchClient = new AgentDispatchClient(httpUrl, apiKey, apiSecret);
    const roomSvc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
    let participants: Awaited<ReturnType<RoomServiceClient["listParticipants"]>> = [];

    try {
      participants = await roomSvc.listParticipants(roomName);
    } catch (error) {
      console.log("[dispatch] participant list unavailable before dispatch", {
        roomName,
        error: error instanceof Error ? error.message : error,
      });
    }

    const participantList = describeParticipants(participants);
    const hasAgent = participantList.some((p) => p.kind === 4 && p.state !== 3);
    console.log("[dispatch] participant list before dispatch", {
      roomName,
      participants: participantList,
      hasAgent,
    });

    if (hasAgent) {
      console.log("[dispatch] skipped — active agent already present", {
        roomName,
        agentName: AGENT_NAME,
      });
      return;
    }

    const dispatch = await dispatchClient.createDispatch(roomName, AGENT_NAME);
    console.log("[dispatch] created", {
      roomName,
      agentName: dispatch.agentName,
      dispatchId: (dispatch as { id?: string; dispatchId?: string }).id
        ?? (dispatch as { id?: string; dispatchId?: string }).dispatchId
        ?? null,
    });
  })();

  dispatchGuards.set(roomName, {
    expiresAt: now + DISPATCH_GUARD_MS,
    promise,
  });

  try {
    await promise;
  } catch (error) {
    dispatchGuards.delete(roomName);
    console.error("[dispatch] failed", {
      roomName,
      error: error instanceof Error ? error.message : error,
    });
  }
}

async function generateToken(roomName: string, participantName: string) {
  const { apiKey, apiSecret, url } = getLiveKitConfig();
  console.log("[livekit/token] request", {
    roomName,
    participantName,
    url,
    configured: isLiveKitConfigured(),
  });

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
  console.log("[livekit/token] generated", {
    roomName,
    participantName,
    url,
  });

  // Dispatch agent. The in-process guard is set before async LiveKit calls so rapid
  // refreshes cannot race each other before the agent participant appears.
  const httpUrl = url.replace(/^wss?:\/\//, "https://");
  await ensureAgentDispatched({ roomName, httpUrl, apiKey, apiSecret });

  return { token: jwt, serverUrl: url, url, mock: false, roomName, participantName };
}

// GET — used by VoiceAgent.tsx: /api/livekit/token?videoId=X&identity=Y
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const roomName = searchParams.get("videoId") ?? "probeiq-local-server";
    const participantName = searchParams.get("identity") ?? "user-local";
    return NextResponse.json(await generateToken(roomName, participantName));
  } catch (error) {
    console.error("[/api/livekit/token GET]", error);
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { roomName = "probeiq-local-server", participantName = "user-local" } =
      await request.json();
    return NextResponse.json(await generateToken(roomName, participantName));
  } catch (error) {
    console.error("[/api/livekit/token POST]", error);
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}
