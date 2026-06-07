export type UIActionType =
  | "seek_video"
  | "show_image"
  | "highlight_term"
  | "show_procedure_step"
  | "show_tooth_comparison";

export interface SeekVideoAction {
  type: "seek_video";
  timestamp: number;
}

export interface ShowImageAction {
  type: "show_image";
  image_url: string;
  title?: string;
  caption?: string;
}

export interface HighlightTermAction {
  type: "highlight_term";
  term: string;
}

export interface ShowProcedureStepAction {
  type: "show_procedure_step";
  step: string;
}

export interface ShowToothComparisonAction {
  type: "show_tooth_comparison";
  stages: string[];
}

export type UIAction =
  | SeekVideoAction
  | ShowImageAction
  | HighlightTermAction
  | ShowProcedureStepAction
  | ShowToothComparisonAction;

export interface AIResponse {
  speak: string;
  ui_actions: UIAction[];
}

export interface DentalTerm {
  id: string;
  term: string;
  definition: string;
  category: "anatomy" | "procedure" | "condition";
  related_terms?: string[];
}

export interface ToothStage {
  id: string;
  name: string;
  stage: number;
  description: string;
  image_url: string;
  characteristics: string[];
}

export interface ProcedureStep {
  id: string;
  slug: string;
  title: string;
  description: string;
  timestamp_start: number;
  timestamp_end: number;
  key_terms: string[];
  reasoning?: string;
}

export interface TimelineMarker {
  id: string;
  timestamp: number;
  label: string;
  step_id: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  ui_actions?: UIAction[];
}

export interface VideoState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
}
