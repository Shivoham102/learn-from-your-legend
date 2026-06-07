"use client";

import { useEffect, useRef, useState } from "react";
import { Lightbulb, Sparkles } from "lucide-react";
import type { ChatMessage, UIAction } from "@/types/dental";
import { getActionLabel } from "@/lib/uiActions";
import KnowledgeCard from "./KnowledgeCard";
import { VoiceAgent, type VoiceTurn } from "./VoiceAgent";

interface ProcedureCardData {
  title: string;
  description: string;
  reasoning?: string;
  tags: string[];
}

interface TermCardData {
  id: string;
  term: string;
  definition: string;
  category: string;
  related_terms?: string[];
}

interface AITutorPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isLoading?: boolean;
  highlightedTerms?: string[];
  procedureCard?: ProcedureCardData | null;
  onCloseProcedureCard?: () => void;
  termCards?: TermCardData[];
}

export default function AITutorPanel({
  messages,
  onSendMessage,
  isLoading = false,
  highlightedTerms = [],
  procedureCard,
  onCloseProcedureCard,
  termCards = [],
}: AITutorPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [voiceTurns, setVoiceTurns] = useState<VoiceTurn[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, voiceTurns, isLoading, procedureCard, termCards]);

  const hasContextCards =
    procedureCard || termCards.length > 0 || highlightedTerms.length > 0;

  return (
    <div className="flex min-h-[500px] h-full flex-col rounded-2xl border border-[#E6ECEF] bg-white card-shadow">
      <div className="border-b border-[#E6ECEF] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#DDF5EF]">
            <Sparkles className="h-5 w-5 text-[#2DB6A3]" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#1F2933]">
              AI Dental Tutor
            </h2>
            <p className="text-xs text-[#667085]">Powered by Moss + LiveKit</p>
          </div>
        </div>
      </div>

      {hasContextCards && (
        <div className="border-b border-[#E6ECEF] bg-[#F7FAF9] px-4 py-3 space-y-3 max-h-[280px] overflow-y-auto">
          {highlightedTerms.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[#667085]">
                Active Terms
              </p>
              <div className="flex flex-wrap gap-2">
                {highlightedTerms.map((term) => (
                  <span
                    key={term}
                    className="rounded-full border border-[#2DB6A3]/30 bg-[#DDF5EF] px-3 py-1 text-xs font-medium text-[#2DB6A3]"
                  >
                    {term}
                  </span>
                ))}
              </div>
            </div>
          )}

          {procedureCard && (
            <div>
              <KnowledgeCard
                title={procedureCard.title}
                description={procedureCard.description}
                category="Procedure Step"
                tags={procedureCard.tags}
                isHighlighted
                compact
                onClose={onCloseProcedureCard}
              />
              {procedureCard.reasoning && (
                <div className="mt-2 rounded-xl border border-[#E6ECEF] bg-white p-3">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Lightbulb
                      className="h-3.5 w-3.5 text-[#4A90E2]"
                      strokeWidth={2}
                    />
                    <p className="text-xs font-medium text-[#4A90E2]">
                      Clinical Reasoning
                    </p>
                  </div>
                  <p className="text-xs leading-relaxed text-[#667085]">
                    {procedureCard.reasoning}
                  </p>
                </div>
              )}
            </div>
          )}

          {termCards.map((term) => (
            <KnowledgeCard
              key={term.id}
              title={term.term}
              description={term.definition}
              category={term.category}
              tags={term.related_terms}
              isHighlighted
              compact
            />
          ))}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && voiceTurns.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <p className="text-sm text-[#667085]">
              Ask about the procedure while you watch
            </p>
            <p className="max-w-xs text-xs text-[#667085]/80">
              Try: &ldquo;Why did the dentist stop drilling here?&rdquo;
            </p>
          </div>
        )}

        {/* Voice transcripts — rendered in main chat area */}
        {voiceTurns.map((turn, i) => (
          <div
            key={`voice-${i}`}
            className={`flex ${turn.isAgent ? "justify-start" : "justify-end"}`}
          >
            <p
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                turn.isAgent
                  ? "border border-[#E6ECEF] bg-[#F7FAF9] text-[#1F2933]"
                  : "bg-[#4A90E2] text-white"
              }`}
            >
              {turn.text}
            </p>
          </div>
        ))}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-[#4A90E2] text-white"
                  : "border border-[#E6ECEF] bg-[#F7FAF9] text-[#1F2933]"
              }`}
            >
              <p className="text-sm leading-relaxed">{msg.content}</p>
              {msg.ui_actions && msg.ui_actions.length > 0 && (
                <div
                  className={`mt-3 flex flex-wrap gap-1.5 border-t pt-3 ${
                    msg.role === "user"
                      ? "border-white/20"
                      : "border-[#E6ECEF]"
                  }`}
                >
                  {msg.ui_actions.map((action, i) => (
                    <ActionBadge key={i} action={action} isUser={msg.role === "user"} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-[#E6ECEF] bg-[#F7FAF9] px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-2 w-2 animate-bounce rounded-full bg-[#2DB6A3]/60"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-[#E6ECEF] bg-[#F7FAF9] px-4 py-2">
        <VoiceAgent onTurnsChange={setVoiceTurns} />
      </div>

    </div>
  );
}

function ActionBadge({
  action,
  isUser,
}: {
  action: UIAction;
  isUser: boolean;
}) {
  const colors: Record<string, string> = {
    seek_video: isUser
      ? "border-white/30 bg-white/15 text-white"
      : "border-[#4A90E2]/30 bg-[#EAF4FF] text-[#4A90E2]",
    show_image: isUser
      ? "border-white/30 bg-white/15 text-white"
      : "border-[#2DB6A3]/30 bg-[#DDF5EF] text-[#2DB6A3]",
    highlight_term: isUser
      ? "border-white/30 bg-white/15 text-white"
      : "border-[#4A90E2]/30 bg-[#EAF4FF] text-[#4A90E2]",
    show_procedure_step: isUser
      ? "border-white/30 bg-white/15 text-white"
      : "border-[#2DB6A3]/30 bg-[#DDF5EF] text-[#259688]",
    show_tooth_comparison: isUser
      ? "border-white/30 bg-white/15 text-white"
      : "border-[#667085]/30 bg-[#F6F2EE] text-[#667085]",
  };

  const detail =
    action.type === "seek_video"
      ? `@ ${action.timestamp}s`
      : action.type === "highlight_term"
        ? action.term
        : action.type === "show_procedure_step"
          ? action.step
          : action.type === "show_image"
            ? "image"
            : "compare";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${colors[action.type] ?? ""}`}
    >
      {getActionLabel(action.type)} · {detail}
    </span>
  );
}
