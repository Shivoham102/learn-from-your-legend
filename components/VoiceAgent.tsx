"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useRoomContext,
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
import { getBrowserLiveKitIdentity } from "@/lib/liveKitIdentity";

const SPEECH_FALLBACK_TOPIC = "speech-fallback";
const DUPLICATE_IDENTITY_REASON = 2;

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
  onSendReady?: (sender: ((payload: Record<string, unknown>) => void) | null) => void;
  currentTime?: number;
}) {
  const { state } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const isConnected = connectionState === ConnectionState.Connected;
  const allTranscriptions = useTranscriptions();

  useEffect(() => {
    console.log("[VoiceAgent/livekit] state", {
      connectionState,
      agentState: state,
      localIdentity: localParticipant.identity,
      remoteParticipantCount: room.remoteParticipants.size,
      canPlaybackAudio: room.canPlaybackAudio,
      audioContextState:
        (room as unknown as { audioContext?: AudioContext }).audioContext
          ?.state ?? "unknown",
      agentParticipants:
        Array.from(room.remoteParticipants.values())
          .filter((p) => p.isAgent)
          .map((p) => p.identity),
    });
  }, [connectionState, state, localParticipant, room]);
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
    if (!onSendReady) return;
    if (!isConnected) {
      onSendReady(null);
      return;
    }
    const enc = new TextEncoder();
    onSendReady((payload) => {
      if (!isConnectedRef.current) {
        console.warn("[VoiceAgent/data] publish skipped — disconnected", payload);
        return;
      }
      if (payload.type === "narrate_segment") {
        console.log("publishData narrate_segment start", payload);
      }
      console.log("[VoiceAgent/data] publish start", payload);
      localParticipant
        .publishData(enc.encode(JSON.stringify(payload)), { reliable: true })
        .then(() => {
          if (payload.type === "narrate_segment") {
            console.log("publishData narrate_segment ok", payload);
          }
          console.log("[VoiceAgent/data] publish ok", payload);
        })
        .catch((error) => {
          console.warn("[VoiceAgent/data] publish failed", {
            payload,
            error,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    });
    return () => onSendReady(null);
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

  useDataChannel(SPEECH_FALLBACK_TOPIC, (msg) => {
    try {
      const raw = new TextDecoder().decode(msg.payload);
      const payload = JSON.parse(raw) as { text?: unknown; reason?: unknown };
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }
      console.warn("[VoiceAgent] browser speech fallback", {
        reason: payload.reason,
        text,
      });
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch (error) {
      console.warn("[VoiceAgent] browser speech fallback failed", error);
    }
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
  onSendReady?: (sender: ((payload: Record<string, unknown>) => void) | null) => void;
  currentTime?: number;
}

export function VoiceAgent({
  roomName,
  onTurnsChange,
  onVideoControl,
  onSendReady,
  currentTime,
}: VoiceAgentProps) {
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [duplicateIdentityMessage, setDuplicateIdentityMessage] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<ReturnType<typeof getBrowserLiveKitIdentity> | null>(null);

  useEffect(() => {
    setSessionInfo(getBrowserLiveKitIdentity());
  }, []);

  const effectiveRoomName = roomName ?? sessionInfo?.roomName;
  const participantIdentity = sessionInfo?.identity;

  useEffect(() => {
    if (!effectiveRoomName || !participantIdentity) return;
    const ac = new AbortController();
    setDuplicateIdentityMessage(null);
    fetch(
      `/api/livekit/token?videoId=${encodeURIComponent(effectiveRoomName)}&identity=${encodeURIComponent(participantIdentity)}`,
      { signal: ac.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error(`Token fetch failed: ${r.status}`);
        return r.json() as Promise<ConnectionInfo>;
      })
      .then((info) => {
        console.log("[VoiceAgent] token fetched", {
          roomName: effectiveRoomName,
          participantIdentity,
          serverUrl: info.serverUrl,
        });
        setConnectionInfo(info);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setFetchError(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, [effectiveRoomName, participantIdentity]);

  if (fetchError) {
    return (
      <p className="text-center text-[10px] text-red-500">{fetchError}</p>
    );
  }

  if (duplicateIdentityMessage) {
    return (
      <p className="text-center text-[10px] text-red-500">
        {duplicateIdentityMessage}
      </p>
    );
  }

  if (!connectionInfo || !effectiveRoomName || !participantIdentity) {
    return <VoiceOrb state="listening" />;
  }

  return (
    <LiveKitRoom
      token={connectionInfo.token}
      serverUrl={connectionInfo.serverUrl}
      audio={false}
      video={false}
      onConnected={() => {
        console.log("[VoiceAgent] room connected", {
          roomName: effectiveRoomName,
          participantIdentity,
          serverUrl: connectionInfo.serverUrl,
        });
      }}
      onDisconnected={(reason) => {
        console.warn("[VoiceAgent] room disconnected", {
          roomName: effectiveRoomName,
          participantIdentity,
          reason,
        });
        onSendReady?.(null);
        if (Number(reason) === DUPLICATE_IDENTITY_REASON) {
          setConnectionInfo(null);
          setDuplicateIdentityMessage(
            "Duplicate tab detected — close other tabs or reconnect."
          );
        }
      }}
      onError={(error) => {
        console.error("[VoiceAgent] room connection error", {
          roomName: effectiveRoomName,
          participantIdentity,
          serverUrl: connectionInfo.serverUrl,
          message: error.message,
        });
      }}
    >
      <RoomAudioRenderer />
      <VoiceSection onTurnsChange={onTurnsChange} onVideoControl={onVideoControl} onSendReady={onSendReady} currentTime={currentTime} />
    </LiveKitRoom>
  );
}
