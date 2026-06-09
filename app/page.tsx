"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AITutorPanel from "@/components/AITutorPanel";
import DentalVideoPlayer, {
  type DentalVideoPlayerHandle,
} from "@/components/DentalVideoPlayer";
import ProcedureTimeline from "@/components/ProcedureTimeline";
import VideoCommandChips from "@/components/VideoCommandChips";
import { executeUIActions } from "@/lib/uiActions";
import {
  createVideoController,
  type VideoCommand,
  type VideoController,
} from "@/lib/videoControl";
import {
  DEMO_QUESTION,
  getProcedureStepBySlug,
  getTermBySlug,
} from "@/lib/sampleData";
import {
  findSegmentByTime,
  PROCEDURE_DURATION,
  PROCEDURE_TIMELINE_MARKERS,
  type ProcedureSegment,
} from "@/lib/procedureData";
import type { AIResponse, ChatMessage } from "@/types/dental";

export default function DentalEducationPage() {
  const videoRef = useRef<DentalVideoPlayerHandle>(null);
  const sendToAgentRef = useRef<((payload: Record<string, unknown>) => void) | null>(null);
  // Adapter that drives the <video> element directly for voice tool calls.
  // Created lazily inside a callback (not during render) so the React Compiler's
  // ref rules are satisfied; the accessor reads the latest <video> on each call.
  const controllerRef = useRef<VideoController | null>(null);
  const getController = useCallback(() => {
    if (!controllerRef.current) {
      controllerRef.current = createVideoController(
        () => videoRef.current?.getVideoElement() ?? null
      );
    }
    return controllerRef.current;
  }, []);

  const handleVideoControl = useCallback(
    (command: VideoCommand) => getController().handleCommand(command),
    [getController]
  );

  // Dev-only: expose the adapter on window so the video-control tool calls can
  // be verified from the browser console without the full voice stack, e.g.
  //   __videoControl.pauseVideo()
  //   __videoControl.seekVideo(42)
  //   __videoControl.handleCommand({ action: "rewind", seconds: 10 })
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __videoControl?: unknown }).__videoControl =
        getController();
    }
  }, [getController]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(PROCEDURE_DURATION);
  const [highlightedTerms, setHighlightedTerms] = useState<string[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | undefined>();
  const [procedureCard, setProcedureCard] = useState<{
    title: string;
    description: string;
    reasoning?: string;
    tags: string[];
  } | null>(null);
  const termCards = useMemo(
    () =>
      highlightedTerms
        .map((slug) => getTermBySlug(slug))
        .filter(Boolean)
        .map((term) => ({
          id: term!.id,
          term: term!.term,
          definition: term!.definition,
          category: term!.category,
          related_terms: term!.related_terms,
        })),
    [highlightedTerms]
  );

  const actionHandlers = {
    onSeekVideo: (timestamp: number) => {
      videoRef.current?.seekTo(timestamp);
      setCurrentTime(timestamp);
      const seg = findSegmentByTime(timestamp);
      if (seg) setActiveStepId(seg.id);
    },
    onShowImage: (_url: string, _title?: string) => {},
    onHighlightTerm: (term: string) => {
      setHighlightedTerms((prev) =>
        prev.includes(term) ? prev : [...prev, term]
      );
    },
    onShowProcedureStep: (step: string) => {
      const procedureStep = getProcedureStepBySlug(step);
      if (procedureStep) {
        setActiveStepId(procedureStep.id);
        setProcedureCard({
          title: procedureStep.title,
          description: procedureStep.description,
          reasoning: procedureStep.reasoning,
          tags: procedureStep.key_terms,
        });
      }
    },
    onShowToothComparison: (_stages: string[]) => {},
  };

  const processAIResponse = useCallback((response: AIResponse) => {
    executeUIActions(response.ui_actions, actionHandlers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendMessage = useCallback(
    async (question: string) => {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: question,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });

        if (!res.ok) throw new Error("Failed to get response");

        const data: AIResponse = await res.json();

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.speak,
          timestamp: new Date(),
          ui_actions: data.ui_actions,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        processAIResponse(data);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Sorry, I couldn't process that question. Please try again.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [processAIResponse]
  );

  const handleChipClick = useCallback((question: string) => {
    // Add user bubble in chat immediately
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: question, timestamp: new Date() },
    ]);
    // Route to voice agent — no text API call, no ui_actions
    if (sendToAgentRef.current) {
      sendToAgentRef.current({ type: "user_interrupt" });
      sendToAgentRef.current({ type: "text_question", question });
    }
  }, []);

  const handleRunDemo = () => {
    handleSendMessage(DEMO_QUESTION);
  };

  const handleTimelineSeek = (timestamp: number) => {
    actionHandlers.onSeekVideo(timestamp);
  };

  const handleVideoPlay = useCallback(() => {
    const t = videoRef.current?.getCurrentTime() ?? currentTime;
    const segment = findSegmentByTime(t) ?? null;
    console.log("[narration-test] requestNarration called", {
      currentTime: t,
      segmentId: segment?.id ?? null,
      stepName: segment?.step_name ?? null,
      hasSender: Boolean(sendToAgentRef.current),
    });

    const serializeSegment = (seg: ProcedureSegment | null) =>
      seg
        ? {
            id: seg.id,
            step_name: seg.step_name,
            phase: seg.phase,
            context: seg.context,
            start: seg.start,
            end: seg.end,
          }
        : null;

    if (!sendToAgentRef.current) {
      console.warn("[narration-test] requestNarration skipped — no sender");
      return;
    }

    sendToAgentRef.current({
      type: "narrate_segment",
      ts: t,
      segment: serializeSegment(segment),
    });
  }, [currentTime]);


  return (
    <div className="relative min-h-screen bg-[#F7FAF9] text-[#1F2933]">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-32 top-0 h-[480px] w-[480px] rounded-full bg-[#DDF5EF]/40 blur-[100px]" />
        <div className="absolute -right-32 top-1/3 h-[400px] w-[400px] rounded-full bg-[#EAF4FF]/50 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1600px] px-4 py-6 pb-24 lg:px-8">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#2DB6A3] shadow-md shadow-[#2DB6A3]/20">
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8 2 5 5 4 9c-1 4-1 8 3 12 2 2 4 4 5 5 1-1 3-3 5-5 4-4 4-8 3-12-1-4-4-7-8-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[#1F2933]">
                Probe <span className="text-[#2DB6A3]">IQ</span>
              </h1>
              <p className="text-xs text-[#667085]">
                Immersive dental procedure learning
              </p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <DentalVideoPlayer
              ref={videoRef}
              onTimeUpdate={(t) => {
                setCurrentTime(t);
                const seg = findSegmentByTime(t);
                if (seg) setActiveStepId(seg.id);
              }}
              onDurationChange={setDuration}
              onPlay={handleVideoPlay}
            />

            <VideoCommandChips
              segment={findSegmentByTime(currentTime) ?? null}
              onChipClick={handleChipClick}
            />

          </div>

          <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-7rem)]">
            <AITutorPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
              highlightedTerms={highlightedTerms}
              onRunDemo={handleRunDemo}
              procedureCard={procedureCard}
              onCloseProcedureCard={() => setProcedureCard(null)}
              termCards={termCards}
              onVideoControl={handleVideoControl}
              onSendReady={(sender) => {
                sendToAgentRef.current = sender;
              }}
              currentTime={currentTime}
            />
          </div>
        </div>
      </div>

      <ProcedureTimeline
        markers={PROCEDURE_TIMELINE_MARKERS}
        currentTime={currentTime}
        duration={duration}
        activeStepId={activeStepId}
        onSeek={handleTimelineSeek}
      />
    </div>
  );
}
