"use client";

import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useTranscriptions,
  useVoiceAssistant,
} from "@livekit/components-react";
import "@livekit/components-styles";
import VoiceOrb, { type VoiceOrbState } from "./VoiceOrb";

type ConnectionInfo = {
  token: string;
  serverUrl: string;
};

function agentStateToOrbState(state: string): VoiceOrbState {
  if (state === "speaking") return "ai-speaking";
  return "listening";
}

function VoiceSection() {
  const { state, agent } = useVoiceAssistant();
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
  const orbState = agentStateToOrbState(state);

  return (
    <>
      <VoiceOrb state={orbState} />
      {(lastUser || lastAgent) && (
        <div className="flex flex-col gap-1 px-2 pt-1 pb-2 text-xs">
          {lastUser && (
            <p className="self-end rounded-xl bg-blue-50 px-3 py-1.5 text-blue-800">
              {lastUser}
            </p>
          )}
          {lastAgent && (
            <p className="self-start rounded-xl bg-[#F7FAF9] px-3 py-1.5 text-[#1F2933]">
              {lastAgent}
            </p>
          )}
        </div>
      )}
    </>
  );
}

interface VoiceAgentProps {
  roomName?: string;
}

export function VoiceAgent({ roomName = "dental-tutor-room" }: VoiceAgentProps) {
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/livekit/token?videoId=${encodeURIComponent(roomName)}&identity=student`)
      .then((r) => {
        if (!r.ok) throw new Error(`Token fetch failed: ${r.status}`);
        return r.json() as Promise<ConnectionInfo>;
      })
      .then(setConnectionInfo)
      .catch((e: unknown) =>
        setFetchError(e instanceof Error ? e.message : String(e)),
      );
  }, [roomName]);

  if (fetchError) {
    return (
      <p className="text-center text-[10px] text-red-500">{fetchError}</p>
    );
  }

  if (!connectionInfo) {
    return <VoiceOrb state="listening" />;
  }

  return (
    <LiveKitRoom
      token={connectionInfo.token}
      serverUrl={connectionInfo.serverUrl}
      audio={true}
      video={false}
    >
      <RoomAudioRenderer />
      <VoiceSection />
    </LiveKitRoom>
  );
}
