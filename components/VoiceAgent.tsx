"use client";

import { useCallback, useEffect, useState } from "react";
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

function resolveOrbState(agentState: string, pttActive: boolean): VoiceOrbState {
  if (pttActive) return "user-speaking";
  if (agentState === "speaking") return "ai-speaking";
  return "listening";
}

export type VoiceTurn = { text: string; isAgent: boolean };

function VoiceSection({
  onTurnsChange,
}: {
  onTurnsChange?: (turns: VoiceTurn[]) => void;
}) {
  const { state } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const allTranscriptions = useTranscriptions();
  const [pttActive, setPttActive] = useState(false);

  const handleOrbClick = useCallback(async () => {
    const next = !pttActive;
    setPttActive(next);
    await localParticipant.setMicrophoneEnabled(next);
  }, [pttActive, localParticipant]);

  // Reset PTT when agent starts speaking (agent has the floor)
  useEffect(() => {
    if (state === "speaking" && pttActive) {
      setPttActive(false);
      localParticipant.setMicrophoneEnabled(false).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Recompute on any text change (streaming partial STT updates) not just new segments.
  const transcriptKey = allTranscriptions.map((t) => t.text).join("\0");

  useEffect(() => {
    if (!onTurnsChange) return;
    const userIdentity = localParticipant.identity;
    // Dedupe by text: two agents or streaming duplicates produce same text;
    // reverse-iterate so last (most complete) segment wins.
    const seen = new Set<string>();
    const deduped: VoiceTurn[] = [];
    for (const t of [...allTranscriptions].reverse()) {
      if (!seen.has(t.text)) {
        seen.add(t.text);
        deduped.unshift({ text: t.text, isAgent: t.participantInfo.identity !== userIdentity });
      }
    }
    onTurnsChange(deduped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptKey]);

  const orbState = resolveOrbState(state, pttActive);
  return <VoiceOrb state={orbState} onClick={handleOrbClick} />;
}

interface VoiceAgentProps {
  roomName?: string;
  onTurnsChange?: (turns: VoiceTurn[]) => void;
}

export function VoiceAgent({ roomName = "dental-tutor-room", onTurnsChange }: VoiceAgentProps) {
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(
      `/api/livekit/token?videoId=${encodeURIComponent(roomName)}&identity=student`,
      { signal: ac.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error(`Token fetch failed: ${r.status}`);
        return r.json() as Promise<ConnectionInfo>;
      })
      .then(setConnectionInfo)
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setFetchError(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
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
      audio={false}
      video={false}
    >
      <RoomAudioRenderer />
      <VoiceSection onTurnsChange={onTurnsChange} />
    </LiveKitRoom>
  );
}
