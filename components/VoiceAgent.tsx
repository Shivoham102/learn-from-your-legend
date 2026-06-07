"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useTranscriptions,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import "@livekit/components-styles";
import VoiceOrb, { type VoiceOrbState } from "./VoiceOrb";
import {
  parseVideoCommand,
  VIDEO_CONTROL_TOPIC,
  type VideoCommand,
} from "@/lib/videoControl";

type ConnectionInfo = {
  token: string;
  serverUrl: string;
};

function resolveOrbState(agentState: string, micEnabled: boolean): VoiceOrbState {
  if (agentState === "speaking") return "ai-speaking";
  if (micEnabled) return "user-speaking";
  return "listening";
}

export type VoiceTurn = { text: string; isAgent: boolean };

function VoiceSection({
  onTurnsChange,
  onVideoControl,
}: {
  onTurnsChange?: (turns: VoiceTurn[]) => void;
  onVideoControl?: (command: VideoCommand) => void;
}) {
  const { state } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const isConnected = connectionState === ConnectionState.Connected;
  const allTranscriptions = useTranscriptions();
  // Always-listening: the mic turns on as soon as the room is connected. The orb
  // toggles mute, but speaking does not require holding the button (no PTT).
  const [micEnabled, setMicEnabled] = useState(true);

  // Enable the mic only once the engine is actually connected — publishing the
  // track before then throws "engine not connected within timeout".
  useEffect(() => {
    if (isConnected && micEnabled) {
      localParticipant.setMicrophoneEnabled(true).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  const handleOrbClick = useCallback(async () => {
    if (!isConnected) return; // can't publish/unpublish until connected
    const next = !micEnabled;
    setMicEnabled(next);
    await localParticipant.setMicrophoneEnabled(next).catch(() => {});
  }, [isConnected, micEnabled, localParticipant]);

  // Receive structured video-control tool calls from the agent and dispatch
  // them to the video adapter. Logged so each trigger is easy to verify.
  useDataChannel(VIDEO_CONTROL_TOPIC, (msg) => {
    const command = parseVideoCommand(msg.payload);
    if (!command) return;
    console.log("[VoiceAgent] video-control received", command);
    onVideoControl?.(command);
  });

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

  const orbState = resolveOrbState(state, isConnected && micEnabled);
  return <VoiceOrb state={orbState} onClick={handleOrbClick} />;
}

interface VoiceAgentProps {
  roomName?: string;
  onTurnsChange?: (turns: VoiceTurn[]) => void;
  onVideoControl?: (command: VideoCommand) => void;
}

export function VoiceAgent({
  roomName = "dental-tutor-room",
  onTurnsChange,
  onVideoControl,
}: VoiceAgentProps) {
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
      <VoiceSection onTurnsChange={onTurnsChange} onVideoControl={onVideoControl} />
    </LiveKitRoom>
  );
}
