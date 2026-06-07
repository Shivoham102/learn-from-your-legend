/**
 * LLM layer — converts Moss retrieval context into tutor speak + UI actions.
 *
 * Workflow: User Question → Moss Retrieval → Context → LLM → Structured Response
 *
 * TODO: Wire a real LLM when OPENAI_API_KEY (or ANTHROPIC_API_KEY) is set.
 * Until then, responses are synthesized deterministically from Moss context
 * (not hardcoded Q&A pairs).
 */

import type { AIResponse, UIAction } from "@/types/dental";
import type { DentalAnswerContext } from "@/types/moss";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

export async function generateTutorResponse(
  question: string,
  context: DentalAnswerContext
): Promise<AIResponse> {
  if (OPENAI_API_KEY) {
    try {
      return await callOpenAI(question, context);
    } catch (error) {
      console.error("[LLM] OpenAI call failed, using context synthesis:", error);
    }
  }

  return synthesizeFromContext(question, context);
}

/**
 * TODO: Replace with production LLM call.
 * Pass Moss context as system context; require JSON matching AIResponse schema.
 */
async function callOpenAI(
  question: string,
  context: DentalAnswerContext
): Promise<AIResponse> {
  const systemPrompt = `You are a dental education AI tutor. Use ONLY the provided Moss retrieval context.
Return valid JSON: { "speak": string, "ui_actions": Array<{type, ...}> }
UI action types: seek_video, show_image, highlight_term, show_procedure_step, show_tooth_comparison`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({ question, context }),
        },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return JSON.parse(content) as AIResponse;
}

/** Builds speak + ui_actions purely from Moss retrieval results. */
function synthesizeFromContext(
  question: string,
  context: DentalAnswerContext
): AIResponse {
  const ui_actions: UIAction[] = [];
  const speakParts: string[] = [];

  const topMoment = context.procedureMoments[0];
  const topTerms = context.terminology.slice(0, 3);
  const topImages = context.images.slice(0, 3);

  if (topMoment) {
    ui_actions.push({
      type: "seek_video",
      timestamp: topMoment.timestamp,
    });
    if (topMoment.stepSlug) {
      ui_actions.push({
        type: "show_procedure_step",
        step: topMoment.stepSlug,
      });
    }
    speakParts.push(
      topMoment.description ??
        `This relates to ${topMoment.title} at ${formatTime(topMoment.timestamp)} in the procedure.`
    );
  }

  for (const term of topTerms) {
    ui_actions.push({ type: "highlight_term", term: term.term });
    if (!topMoment) {
      speakParts.push(`${term.term}: ${term.description}`);
    }
  }

  if (topImages.length >= 2) {
    const decayStages = topImages
      .filter((img) => img.stage > 0)
      .map((img) => img.id);
    if (decayStages.length >= 2) {
      ui_actions.push({
        type: "show_tooth_comparison",
        stages: decayStages.slice(0, 2),
      });
    }
  }

  if (topImages[0]) {
    ui_actions.push({
      type: "show_image",
      image_url: topImages[0].imageUrl,
      title: topImages[0].title,
    });
    if (topImages[0].stage > 0 && !speakParts.length) {
      speakParts.push(
        `${topImages[0].title}: ${topImages[0].description}`
      );
    }
  }

  if (!speakParts.length && topTerms[0]) {
    speakParts.push(`${topTerms[0].term}: ${topTerms[0].description}`);
  }

  const speak =
    speakParts.join(" ") ||
    buildFallbackSpeak(question, context);

  return { speak, ui_actions: dedupeActions(ui_actions) };
}

function buildFallbackSpeak(
  question: string,
  context: DentalAnswerContext
): string {
  const hasResults =
    context.terminology.length +
      context.images.length +
      context.procedureMoments.length >
    0;

  if (!hasResults) {
    return `I searched the dental knowledge base for "${question}" but found no closely matching terminology, tooth conditions, or procedure moments. Try asking about dentin, decay stages, or a specific procedure step.`;
  }

  return "Here is what the retrieval layer found relevant to your question about this procedure.";
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function dedupeActions(actions: UIAction[]): UIAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = JSON.stringify(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
