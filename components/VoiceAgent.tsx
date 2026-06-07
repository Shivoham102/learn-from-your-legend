"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

export type VoiceTurn = { text: string; isAgent: boolean; createdAt: number };

function VoiceSection({
  onTurnsChange,
  onVideoControl,
  onSendReady,
  currentTime,
}: {
  onTurnsChange?: (turns: VoiceTurn[]) => void;
  onVideoControl?: (command: VideoCommand) => void;
  onSendReady?: (sender: (payload: Record<string, unknown>) => void) => void;
  currentTime?: number;
}) {
  const { state } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const isConnected = connectionState === ConnectionState.Connected;
  const allTranscriptions = useTranscriptions();
  // Publish current video timestamp to the room every 1s so the agent knows
  // which procedure segment is on screen. Fire-and-forget; drops are fine.
  const currentTimeRef = useRef(currentTime ?? 0);
  useEffect(() => { currentTimeRef.current = currentTime ?? 0; }, [currentTime]);
  const isConnectedRef = useRef(isConnected);
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);
  useEffect(() => {
    const enc = new TextEncoder();
    const id = setInterval(() => {
      if (!isConnectedRef.current) return;
      localParticipant
        .publishData(
          enc.encode(JSON.stringify({ type: "video_timestamp", ts: currentTimeRef.current })),
          { reliable: false },
        )
        .catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [localParticipant]);

  // Mic starts muted — the user taps the orb to start speaking. The orb toggles
  // the mic on/off; nothing is published until the engine is connected.
  // Expose a stable sender so page.tsx can inject chip questions over the data channel.
  useEffect(() => {
    if (!isConnected || !onSendReady) return;
    const enc = new TextEncoder();
    onSendReady((payload) => {
      localParticipant
        .publishData(enc.encode(JSON.stringify(payload)), { reliable: true })
        .catch(() => {});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  const [micEnabled, setMicEnabled] = useState(false);

  const handleOrbClick = useCallback(async () => {
    if (!isConnected) return;
    if (state === "speaking") {
      // Interrupt agent immediately and open mic so user can speak
      if (!micEnabled) {
        setMicEnabled(true);
        await localParticipant.setMicrophoneEnabled(true).catch(() => {});
      }
      const enc = new TextEncoder();
      await localParticipant
        .publishData(enc.encode(JSON.stringify({ type: "user_interrupt" })), { reliable: true })
        .catch(() => {});
    } else {
      const next = !micEnabled;
      setMicEnabled(next);
      await localParticipant.setMicrophoneEnabled(next).catch(() => {});
    }
  }, [isConnected, micEnabled, state, localParticipant]);

  // Receive structured video-control tool calls from the agent and dispatch
  // them to the video adapter. Logged so each trigger is easy to verify.
  useDataChannel(VIDEO_CONTROL_TOPIC, (msg) => {
    const command = parseVideoCommand(msg.payload);
    if (!command) return;
    console.log("[VoiceAgent] video-control received", command);
    onVideoControl?.(command);
  });

  // Track when each unique transcript text was first seen so createdAt is stable.
  const firstSeenRef = useRef<Map<string, number>>(new Map());

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
        if (!firstSeenRef.current.has(t.text)) {
          firstSeenRef.current.set(t.text, Date.now());
        }
        deduped.unshift({
          text: t.text,
          isAgent: t.participantInfo.identity !== userIdentity,
          createdAt: firstSeenRef.current.get(t.text)!,
        });
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
  onSendReady?: (sender: (payload: Record<string, unknown>) => void) => void;
  currentTime?: number;
}

export function VoiceAgent({
  roomName = "dental-tutor-room",
  onTurnsChange,
  onVideoControl,
  onSendReady,
  currentTime,
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
      <VoiceSection onTurnsChange={onTurnsChange} onVideoControl={onVideoControl} onSendReady={onSendReady} currentTime={currentTime} />
    </LiveKitRoom>
  );
}
