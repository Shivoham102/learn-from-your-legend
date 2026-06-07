/**
 * Moss AI retrieval layer for dental educational content.
 *
 * Production setup:
 * 1. Set MOSS_PROJECT_ID and MOSS_API_KEY in .env.local
 * 2. Run POST /api/moss/sync to create indexes:
 *    - dental_terminology
 *    - tooth_condition_images
 *    - procedure_moments
 * 3. Swap local fallback by ensuring credentials are valid — queries
 *    automatically route to Moss when configured.
 *
 * TODO: After indexing production content in Moss, remove reliance on
 * local sample-data fallback in queryIndex().
 */

import {
  DENTAL_TERMS,
  PROCEDURE_STEPS,
  TOOTH_STAGES,
} from "@/lib/sampleData";
import {
  initializeMossClient,
  isMossConfigured,
  queryMossIndex,
} from "@/lib/mossClient";
import type {
  DentalAnswerContext,
  MossIndexName,
  MossRawDocument,
  ProcedureMomentResult,
  TerminologyResult,
  ToothConditionResult,
} from "@/types/moss";
import { MOSS_INDEXES } from "@/types/moss";

export { initializeMossClient, isMossConfigured, MOSS_INDEXES };
export type { DentalAnswerContext, MossQueryResponse } from "@/types/moss";

const RESTORATION_TERM = {
  id: "restoration",
  term: "restoration",
  definition:
    "The final placement of a restorative material to seal the prepared cavity and restore tooth function.",
  category: "procedure" as const,
};

const LOCAL_TOOTH_CONDITIONS: ToothConditionResult[] = TOOTH_STAGES.map(
  (s) => ({
    id: s.id,
    title: s.name,
    description: s.description,
    imageUrl: s.image_url,
    stage: s.stage,
    score: 0,
  })
);

// ---------------------------------------------------------------------------
// Moss index queries
// ---------------------------------------------------------------------------

async function queryIndex(
  indexName: MossIndexName,
  question: string,
  topK = 5
): Promise<MossRawDocument[]> {
  if (isMossConfigured()) {
    try {
      const result = await queryMossIndex(indexName, question, topK);
      return result.docs.map((doc) => ({
        id: doc.id,
        text: doc.text,
        score: doc.score,
        metadata: normalizeMetadata(doc.metadata),
      }));
    } catch (error) {
      console.error(`[Moss] Query failed for "${indexName}":`, error);
    }
  }

  // Local retrieval fallback — mirrors Moss index structure until credentials are set
  return queryLocalIndex(indexName, question, topK);
}

function normalizeMetadata(
  metadata?: Record<string, string | number | boolean>
): Record<string, string> {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata).map(([k, v]) => [k, String(v)])
  );
}

function scoreMatch(query: string, fields: string[]): number {
  let score = 0;
  for (const field of fields) {
    const lower = field.toLowerCase();
    if (query.includes(lower) || lower.includes(query)) score += 1;
    for (const word of query.split(/\s+/)) {
      if (word.length > 2 && lower.includes(word)) score += 0.5;
    }
  }
  return score;
}

function queryLocalIndex(
  indexName: MossIndexName,
  question: string,
  topK: number
): MossRawDocument[] {
  const q = question.toLowerCase();
  const results: MossRawDocument[] = [];

  if (indexName === MOSS_INDEXES.TERMINOLOGY) {
    const terms = [...DENTAL_TERMS, RESTORATION_TERM];
    for (const term of terms) {
      const score = scoreMatch(q, [term.term, term.definition]);
      if (score > 0) {
        results.push({
          id: term.id,
          text: `${term.term}: ${term.definition}`,
          score,
          metadata: {
            type: "terminology",
            term: term.term,
            category: term.category,
          },
        });
      }
    }
  }

  if (indexName === MOSS_INDEXES.TOOTH_CONDITIONS) {
    for (const condition of LOCAL_TOOTH_CONDITIONS) {
      const score = scoreMatch(q, [
        condition.title,
        condition.description,
        `stage ${condition.stage}`,
      ]);
      if (score > 0) {
        results.push({
          id: condition.id,
          text: `${condition.title}: ${condition.description}`,
          score,
          metadata: {
            type: "tooth_condition",
            title: condition.title,
            description: condition.description,
            imageUrl: condition.imageUrl,
            stage: String(condition.stage),
            conditionId: condition.id,
          },
        });
      }
    }
  }

  if (indexName === MOSS_INDEXES.PROCEDURE_MOMENTS) {
    for (const step of PROCEDURE_STEPS) {
      const score = scoreMatch(q, [
        step.title,
        step.description,
        step.slug,
        ...(step.key_terms ?? []),
        ...(step.reasoning ? [step.reasoning] : []),
      ]);
      if (score > 0) {
        const fullDescription = step.reasoning
          ? `${step.description} ${step.reasoning}`
          : step.description;
        results.push({
          id: step.id,
          text: `${step.title}: ${fullDescription}`,
          score,
          metadata: {
            type: "procedure_moment",
            title: step.title,
            timestamp: String(step.timestamp_start),
            stepSlug: step.slug,
            description: fullDescription,
          },
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

function mapTerminology(docs: MossRawDocument[]): TerminologyResult[] {
  return docs.map((doc) => ({
    id: doc.id,
    term: doc.metadata.term ?? doc.text.split(":")[0]?.trim() ?? doc.id,
    description:
      doc.metadata.description ??
      doc.text.split(":").slice(1).join(":").trim() ??
      doc.text,
    category: doc.metadata.category,
    score: doc.score,
  }));
}

function mapToothConditions(docs: MossRawDocument[]): ToothConditionResult[] {
  return docs.map((doc) => ({
    id: doc.metadata.conditionId ?? doc.id,
    title: doc.metadata.title ?? doc.text.split(":")[0]?.trim() ?? doc.id,
    description: doc.metadata.description ?? doc.text,
    imageUrl: doc.metadata.imageUrl ?? "/images/healthy-tooth.png",
    stage: parseInt(doc.metadata.stage ?? "0", 10),
    score: doc.score,
  }));
}

function mapProcedureMoments(docs: MossRawDocument[]): ProcedureMomentResult[] {
  return docs.map((doc) => ({
    id: doc.id,
    timestamp: parseInt(doc.metadata.timestamp ?? "0", 10),
    title: doc.metadata.title ?? doc.text.split(":")[0]?.trim() ?? doc.id,
    description: doc.metadata.description,
    stepSlug: doc.metadata.stepSlug,
    score: doc.score,
  }));
}

export async function queryDentalKnowledge(
  question: string,
  topK = 5
): Promise<TerminologyResult[]> {
  const docs = await queryIndex(MOSS_INDEXES.TERMINOLOGY, question, topK);
  return mapTerminology(docs);
}

export async function queryToothConditions(
  question: string,
  topK = 5
): Promise<ToothConditionResult[]> {
  const docs = await queryIndex(MOSS_INDEXES.TOOTH_CONDITIONS, question, topK);
  return mapToothConditions(docs);
}

export async function queryProcedureMoments(
  question: string,
  topK = 5
): Promise<ProcedureMomentResult[]> {
  const docs = await queryIndex(MOSS_INDEXES.PROCEDURE_MOMENTS, question, topK);
  return mapProcedureMoments(docs);
}

/**
 * Queries all three Moss indexes and merges into a unified context object
 * for the AI Tutor / LLM layer.
 */
export async function generateDentalContext(
  question: string
): Promise<DentalAnswerContext> {
  const [terminology, images, procedureMoments] = await Promise.all([
    queryDentalKnowledge(question, 5),
    queryToothConditions(question, 5),
    queryProcedureMoments(question, 5),
  ]);

  return { terminology, images, procedureMoments };
}
