"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import type { VoiceOrbState } from "@/components/VoiceOrb";

interface UseLiveKitVoiceOptions {
  roomName?: string;
  participantName?: string;
}

export function useLiveKitVoice({
  roomName = "dental-tutor-room",
  participantName = "student",
}: UseLiveKitVoiceOptions = {}) {
  const roomRef = useRef<Room | null>(null);
  const connectingRef = useRef(false);
  const [voiceState, setVoiceState] = useState<VoiceOrbState>("listening");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function establishConnection() {
      if (connectingRef.current || roomRef.current || cancelled) return;
      connectingRef.current = true;

      try {
        const res = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomName, participantName }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Failed to get token");
        }

        const { token, url, mock } = await res.json();

        if (cancelled) return;

        if (mock) {
          setVoiceState("listening");
          return;
        }

        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        room.on(RoomEvent.Disconnected, () => {
          roomRef.current = null;
          connectingRef.current = false;
          setVoiceState("listening");
          if (!cancelled) {
            setTimeout(() => void establishConnection(), 2000);
          }
        });

        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          const localIdentity = room.localParticipant.identity;
          const localSpeaking = speakers.some(
            (s) => s.identity === localIdentity
          );
          const remoteSpeaking = speakers.some(
            (s) => s.identity !== localIdentity
          );
          if (remoteSpeaking) setVoiceState("ai-speaking");
          else if (localSpeaking) setVoiceState("user-speaking");
          else setVoiceState("listening");
        });

        await room.connect(url, token);
        if (cancelled) {
          await room.disconnect();
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(true);
        setVoiceState("listening");
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Connection failed");
          setVoiceState("listening");
        }
      } finally {
        connectingRef.current = false;
      }
    }

    void establishConnection();

    return () => {
      cancelled = true;
      void roomRef.current?.disconnect();
      roomRef.current = null;
      connectingRef.current = false;
    };
  }, [roomName, participantName]);

  return { voiceState, error };
}
