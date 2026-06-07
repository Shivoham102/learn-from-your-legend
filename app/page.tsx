"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import AITutorPanel from "@/components/AITutorPanel";
import DentalVideoPlayer, {
  type DentalVideoPlayerHandle,
} from "@/components/DentalVideoPlayer";
import KnowledgeCard from "@/components/KnowledgeCard";
import ProcedureTimeline from "@/components/ProcedureTimeline";
import ToothStageComparison from "@/components/ToothStageComparison";
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
  PROCEDURE_STEPS,
  TIMELINE_MARKERS,
} from "@/lib/sampleData";
import type { AIResponse, ChatMessage } from "@/types/dental";

export default function DentalEducationPage() {
  const videoRef = useRef<DentalVideoPlayerHandle>(null);
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
  const [duration] = useState(420);
  const [highlightedTerms, setHighlightedTerms] = useState<string[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | undefined>();
  const [comparisonStages, setComparisonStages] = useState<string[]>([]);
  const [procedureCard, setProcedureCard] = useState<{
    title: string;
    description: string;
    reasoning?: string;
    tags: string[];
  } | null>(null);
  const [floatingImage, setFloatingImage] = useState<{
    url: string;
    title?: string;
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
      const step = PROCEDURE_STEPS.find(
        (s) => timestamp >= s.timestamp_start && timestamp <= s.timestamp_end
      );
      if (step) setActiveStepId(step.id);
    },
    onShowImage: (url: string, title?: string) => {
      setFloatingImage({ url, title });
    },
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
    onShowToothComparison: (stages: string[]) => {
      setComparisonStages(stages);
    },
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

  const handleRunDemo = () => {
    handleSendMessage(DEMO_QUESTION);
  };

  const handleTimelineSeek = (timestamp: number) => {
    actionHandlers.onSeekVideo(timestamp);
  };

  const handleCommandChip = (command: string) => {
    if (command === "Rewind 10s") {
      videoRef.current?.rewind(10);
      return;
    }
    if (command === "Show stage 3 vs 4") {
      actionHandlers.onShowToothComparison(["decay_stage_3", "decay_stage_4"]);
      return;
    }
    handleSendMessage(command);
  };

  const hasQuickKnowledge = comparisonStages.length > 0 || floatingImage;

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
                Dent<span className="text-[#2DB6A3]">AI</span> Studio
              </h1>
              <p className="text-xs text-[#667085]">
                Immersive dental procedure learning
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <span className="rounded-full border border-[#E6ECEF] bg-white px-3 py-1 text-xs text-[#667085] card-shadow">
              Case: MOD Composite Restoration
            </span>
            <span className="rounded-full border border-[#2DB6A3]/30 bg-[#DDF5EF] px-3 py-1 text-xs font-medium text-[#2DB6A3]">
              Student View
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <DentalVideoPlayer
              ref={videoRef}
              onTimeUpdate={setCurrentTime}
            />

            <VideoCommandChips onChipClick={handleCommandChip} />

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#4A90E2]" strokeWidth={2} />
                <h2 className="text-sm font-semibold text-[#1F2933]">
                  Quick Knowledge
                </h2>
              </div>

              {!hasQuickKnowledge && (
                <div className="rounded-2xl border border-dashed border-[#E6ECEF] bg-white/60 px-6 py-8 text-center">
                  <p className="text-sm text-[#667085]">
                    Visual references appear here when the tutor highlights
                    concepts from the procedure.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {comparisonStages.length > 0 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 xl:col-span-2">
                    <ToothStageComparison
                      stageIds={comparisonStages}
                      onClose={() => setComparisonStages([])}
                    />
                  </div>
                )}

                {floatingImage && (
                  <div className="animate-in fade-in duration-500">
                    <KnowledgeCard
                      title={floatingImage.title ?? "Reference Image"}
                      description="Visual reference from the dental knowledge base."
                      imageUrl={floatingImage.url}
                      category="Reference"
                      onClose={() => setFloatingImage(null)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:min-h-[calc(100vh-8rem)]">
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
            />
          </div>
        </div>
      </div>

      <ProcedureTimeline
        markers={TIMELINE_MARKERS}
        currentTime={currentTime}
        duration={duration}
        activeStepId={activeStepId}
        onSeek={handleTimelineSeek}
      />
    </div>
  );
}
