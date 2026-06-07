/** Moss index names — create these in the Moss portal before production use. */
export const MOSS_INDEXES = {
  TERMINOLOGY: "dental_terminology",
  TOOTH_CONDITIONS: "tooth_condition_images",
  PROCEDURE_MOMENTS: "procedure_moments",
} as const;

export type MossIndexName =
  (typeof MOSS_INDEXES)[keyof typeof MOSS_INDEXES];

export interface TerminologyResult {
  id: string;
  term: string;
  description: string;
  category?: string;
  score: number;
}

export interface ToothConditionResult {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  stage: number;
  score: number;
}

export interface ProcedureMomentResult {
  id: string;
  timestamp: number;
  title: string;
  description?: string;
  stepSlug?: string;
  score: number;
}

export interface DentalAnswerContext {
  terminology: TerminologyResult[];
  images: ToothConditionResult[];
  procedureMoments: ProcedureMomentResult[];
}

export interface MossQueryResponse {
  answerContext: DentalAnswerContext;
  source: "moss" | "local";
}

export interface MossRawDocument {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, string>;
}
