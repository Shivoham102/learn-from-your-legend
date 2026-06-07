import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import { createVideoSession } from "@/lib/video-processor";
import { getVideo } from "@/lib/video-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("videoId");
  const identity = searchParams.get("identity") ?? "user";

  if (!videoId) {
    return Response.json({ error: "videoId required" }, { status: 400 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !serverUrl) {
    return Response.json(
      { error: "LiveKit env vars not configured" },
      { status: 500 },
    );
  }

  const token = new AccessToken(apiKey, apiSecret, { identity });
  token.addGrant({
    roomJoin: true,
    room: videoId,
    canPublish: true,
    canSubscribe: true,
  });

  // Ensure a video session exists so the agent's status poll doesn't 404.
  if (!getVideo(videoId)) {
    createVideoSession(videoId, "test-video.mp4");
  }

  // Dispatch the agent to the room. Ignore errors — agent may already be present.
  try {
    const dispatch = new AgentDispatchClient(serverUrl, apiKey, apiSecret);
    await dispatch.createDispatch(videoId, "dental-coach");
  } catch {
    // room may not exist yet or agent already dispatched — both fine
  }

  return Response.json({
    token: await token.toJwt(),
    serverUrl,
  });
}
