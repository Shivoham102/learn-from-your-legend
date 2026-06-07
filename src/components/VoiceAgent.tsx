"use client";

import { useEffect, useState } from "react";
import {
  BarVisualizer,
  LiveKitRoom,
  RoomAudioRenderer,
  VoiceAssistantControlBar,
  useLocalParticipant,
  useTranscriptions,
  useVoiceAssistant,
} from "@livekit/components-react";
import "@livekit/components-styles";

type VoiceAgentProps = {
  videoId: string | null;
};

type ConnectionInfo = {
  token: string;
  serverUrl: string;
};

const STATE_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  "pre-connect-buffering": "Buffering...",
  initializing: "Initializing agent...",
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking...",
  speaking: "Speaking",
  failed: "Connection failed",
};

function AgentUI() {
  const { state, audioTrack, agent } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const allTranscriptions = useTranscriptions();

  const agentMessages = allTranscriptions.filter(
    (t) => agent && t.participantInfo.identity === agent.identity,
  );
  const userMessages = allTranscriptions.filter(
    (t) => t.participantInfo.identity === localParticipant.identity,
  );

  const lastAgent = agentMessages.at(-1)?.text ?? null;
  const lastUser = userMessages.at(-1)?.text ?? null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8">
      <div className="flex h-20 w-full items-center justify-center">
        <BarVisualizer
          state={state}
          trackRef={audioTrack}
          barCount={24}
          className="h-14 w-48"
        />
      </div>

      <p className="text-sm font-medium text-zinc-500">
        {STATE_LABELS[state] ?? state}
      </p>

      <div className="flex w-full max-w-lg flex-col gap-2">
        {lastUser && (
          <p className="self-end rounded-xl bg-blue-50 px-4 py-2 text-sm leading-6 text-blue-800">
            You: {lastUser}
          </p>
        )}
        {lastAgent && (
          <p className="self-start rounded-xl bg-zinc-100 px-4 py-2 text-sm leading-6 text-zinc-700">
            Agent: {lastAgent}
          </p>
        )}
      </div>

      <VoiceAssistantControlBar />
    </div>
  );
}

export function VoiceAgent({ videoId }: VoiceAgentProps) {
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(
    null,
  );
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoId) {
      setConnectionInfo(null);
      setFetchError(null);
      return;
    }

    fetch(`/api/livekit/token?videoId=${videoId}&identity=user`)
      .then((r) => {
        if (!r.ok) throw new Error(`Token fetch failed: ${r.status}`);
        return r.json() as Promise<ConnectionInfo>;
      })
      .then(setConnectionInfo)
      .catch((e: unknown) =>
        setFetchError(e instanceof Error ? e.message : String(e)),
      );
  }, [videoId]);

  return (
    <section className="flex h-full min-h-[420px] flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <header className="border-b border-zinc-100 px-6 py-4">
        <h2 className="text-lg font-semibold text-zinc-900">Voice agent</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {videoId
            ? "Ask about the procedure — by timestamp or technique."
            : "Upload a video to start the voice session."}
        </p>
      </header>

      {!videoId ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
          Waiting for video upload...
        </div>
      ) : fetchError ? (
        <div className="flex flex-1 items-center justify-center text-sm text-red-500">
          {fetchError}
        </div>
      ) : !connectionInfo ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
          Connecting to voice session...
        </div>
      ) : (
        <LiveKitRoom
          token={connectionInfo.token}
          serverUrl={connectionInfo.serverUrl}
          audio={true}
          video={false}
          className="flex flex-1 flex-col"
        >
          <RoomAudioRenderer />
          <AgentUI />
        </LiveKitRoom>
      )}
    </section>
  );
}
