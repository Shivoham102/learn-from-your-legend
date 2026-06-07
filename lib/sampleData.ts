import type {
  DentalTerm,
  ProcedureStep,
  TimelineMarker,
  ToothStage,
} from "@/types/dental";

export const DENTAL_TERMS: DentalTerm[] = [
  {
    id: "enamel",
    term: "enamel",
    definition:
      "The hardest, outermost layer of the tooth composed of hydroxyapatite crystals. It protects the underlying dentin and pulp from mechanical and chemical damage.",
    category: "anatomy",
    related_terms: ["dentin", "caries"],
  },
  {
    id: "dentin",
    term: "dentin",
    definition:
      "The calcified tissue beneath the enamel that forms the bulk of the tooth structure. It contains microscopic tubules that connect to the pulp and transmit sensation.",
    category: "anatomy",
    related_terms: ["enamel", "pulp"],
  },
  {
    id: "pulp",
    term: "pulp",
    definition:
      "The innermost soft tissue of the tooth containing nerves, blood vessels, and connective tissue. Exposure during drilling can cause severe pain and requires pulpal protection.",
    category: "anatomy",
    related_terms: ["dentin"],
  },
  {
    id: "caries",
    term: "caries",
    definition:
      "Tooth decay caused by acid-producing bacteria that demineralize enamel and dentin. Progressive caries can lead to pulp involvement if untreated.",
    category: "condition",
    related_terms: ["enamel", "dentin"],
  },
  {
    id: "caries_removal",
    term: "caries removal",
    definition:
      "The clinical process of excavating infected and softened tooth structure using rotary or hand instruments while preserving healthy dentin.",
    category: "procedure",
    related_terms: ["cavity preparation", "selective caries removal"],
  },
  {
    id: "cavity_preparation",
    term: "cavity preparation",
    definition:
      "Shaping the prepared tooth surface to receive a restorative material, following principles of extension for prevention and retention form.",
    category: "procedure",
    related_terms: ["caries removal"],
  },
];

export const TOOTH_STAGES: ToothStage[] = [
  {
    id: "healthy",
    name: "Healthy Tooth",
    stage: 0,
    description:
      "Intact enamel and dentin with no demineralization. The pulp chamber is fully protected.",
    image_url: "/images/healthy-tooth.png",
    characteristics: [
      "Intact enamel layer",
      "No visible demineralization",
      "Pulp fully protected",
    ],
  },
  {
    id: "decay_stage_1",
    name: "Stage 1 Decay",
    stage: 1,
    description:
      "Initial enamel demineralization with white spot lesions.",
    image_url: "/images/decay-stage-1.png",
    characteristics: [
      "Enamel demineralization",
      "Reversible with fluoride",
    ],
  },
  {
    id: "decay_stage_2",
    name: "Stage 2 Decay",
    stage: 2,
    description:
      "Enamel breakdown with early dentin involvement.",
    image_url: "/images/decay-stage-2.png",
    characteristics: [
      "Enamel cavitation",
      "Early dentin softening",
    ],
  },
  {
    id: "decay_stage_3",
    name: "Stage 3 Decay",
    stage: 3,
    description:
      "Advanced dentinal caries with significant softening. Decay extends into dentin but pulp is not yet exposed.",
    image_url: "/images/decay-stage-3.png",
    characteristics: [
      "Enamel breakdown",
      "Soft infected dentin",
      "Pulp not yet exposed",
    ],
  },
  {
    id: "decay_stage_4",
    name: "Stage 4 Decay",
    stage: 4,
    description:
      "Deep caries approaching or involving the pulp. Risk of pulp exposure during excavation is high.",
    image_url: "/images/decay-stage-4.png",
    characteristics: [
      "Deep dentinal involvement",
      "Thin remaining dentin wall",
      "High pulp exposure risk",
    ],
  },
  {
    id: "decay_stage_5",
    name: "Stage 5 Decay",
    stage: 5,
    description:
      "Pulp involvement with potential periapical extension.",
    image_url: "/images/decay-stage-5.png",
    characteristics: [
      "Pulp exposure",
      "Requires endodontic evaluation",
    ],
  },
];

export const PROCEDURE_STEPS: ProcedureStep[] = [
  {
    id: "step_1",
    slug: "access_opening",
    title: "Access Opening",
    description:
      "Create an entry point through enamel to reach the carious lesion in dentin.",
    timestamp_start: 0,
    timestamp_end: 45,
    key_terms: ["enamel", "access"],
  },
  {
    id: "step_2",
    slug: "caries_removal",
    title: "Selective Caries Removal",
    description:
      "Remove infected, softened dentin while preserving affected but remineralizable dentin near the pulp.",
    timestamp_start: 45,
    timestamp_end: 210,
    key_terms: ["dentin", "pulp", "caries"],
    reasoning:
      "The dentist stops drilling here because the decayed dentin has been removed and drilling deeper could risk exposing the pulp.",
  },
  {
    id: "step_3",
    slug: "cavity_preparation",
    title: "Cavity Preparation",
    description:
      "Refine cavity walls and floor to create optimal form for restorative material placement.",
    timestamp_start: 210,
    timestamp_end: 300,
    key_terms: ["cavity preparation", "retention form"],
  },
  {
    id: "step_4",
    slug: "restoration",
    title: "Restoration Placement",
    description:
      "Place composite or amalgam restoration to seal the cavity and restore function.",
    timestamp_start: 300,
    timestamp_end: 420,
    key_terms: ["restoration", "composite"],
  },
];

export const TIMELINE_MARKERS: TimelineMarker[] = PROCEDURE_STEPS.map(
  (step) => ({
    id: step.id,
    timestamp: step.timestamp_start,
    label: step.title,
    step_id: step.id,
  })
);

export const DEMO_QUESTION =
  "Why did the dentist stop drilling here?";

export function getTermBySlug(slug: string): DentalTerm | undefined {
  return DENTAL_TERMS.find(
    (t) => t.term.toLowerCase() === slug.toLowerCase() || t.id === slug
  );
}

export function getProcedureStepBySlug(
  slug: string
): ProcedureStep | undefined {
  return PROCEDURE_STEPS.find((s) => s.slug === slug);
}

export function getToothStageById(id: string): ToothStage | undefined {
  return TOOTH_STAGES.find((s) => s.id === id);
}
