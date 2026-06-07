import type { DocumentInfo } from "@moss-dev/moss";
import {
  DENTAL_TERMS,
  PROCEDURE_STEPS,
  TOOTH_STAGES,
} from "@/lib/sampleData";
import { MOSS_INDEXES } from "@/types/moss";

export function buildTerminologyDocuments(): DocumentInfo[] {
  const restoration = {
    id: "restoration",
    term: "restoration",
    definition:
      "The final placement of a restorative material to seal the prepared cavity and restore tooth function.",
    category: "procedure" as const,
  };

  return [...DENTAL_TERMS, restoration].map((term) => ({
    id: `term-${term.id}`,
    text: `${term.term}: ${term.definition}`,
    metadata: {
      type: "terminology",
      term: term.term,
      category: term.category,
    },
  }));
}

export function buildToothConditionDocuments(): DocumentInfo[] {
  return TOOTH_STAGES.map((stage) => ({
    id: `condition-${stage.id}`,
    text: `${stage.name}: ${stage.description}. ${stage.characteristics.join(". ")}`,
    metadata: {
      type: "tooth_condition",
      title: stage.name,
      description: stage.description,
      imageUrl: stage.image_url,
      stage: String(stage.stage),
      conditionId: stage.id,
    },
  }));
}

export function buildProcedureMomentDocuments(): DocumentInfo[] {
  return PROCEDURE_STEPS.map((step) => ({
    id: `moment-${step.id}`,
    text: `${step.title} at ${step.timestamp_start}s: ${step.description}${step.reasoning ? ` ${step.reasoning}` : ""}`,
    metadata: {
      type: "procedure_moment",
      title: step.title,
      timestamp: String(step.timestamp_start),
      stepSlug: step.slug,
      description: step.description,
    },
  }));
}

export function getAllMossIndexDocuments(): Record<string, DocumentInfo[]> {
  return {
    [MOSS_INDEXES.TERMINOLOGY]: buildTerminologyDocuments(),
    [MOSS_INDEXES.TOOTH_CONDITIONS]: buildToothConditionDocuments(),
    [MOSS_INDEXES.PROCEDURE_MOMENTS]: buildProcedureMomentDocuments(),
  };
}
