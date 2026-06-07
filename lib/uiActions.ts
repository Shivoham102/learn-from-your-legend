import type { UIAction, UIActionType } from "@/types/dental";

export interface UIActionHandlers {
  onSeekVideo: (timestamp: number) => void;
  onShowImage: (url: string, title?: string, caption?: string) => void;
  onHighlightTerm: (term: string) => void;
  onShowProcedureStep: (step: string) => void;
  onShowToothComparison: (stages: string[]) => void;
}

export function executeUIActions(
  actions: UIAction[],
  handlers: UIActionHandlers
): void {
  for (const action of actions) {
    switch (action.type) {
      case "seek_video":
        handlers.onSeekVideo(action.timestamp);
        break;
      case "show_image":
        handlers.onShowImage(
          action.image_url,
          action.title,
          action.caption
        );
        break;
      case "highlight_term":
        handlers.onHighlightTerm(action.term);
        break;
      case "show_procedure_step":
        handlers.onShowProcedureStep(action.step);
        break;
      case "show_tooth_comparison":
        handlers.onShowToothComparison(action.stages);
        break;
    }
  }
}

export function getActionLabel(type: UIActionType): string {
  const labels: Record<UIActionType, string> = {
    seek_video: "Seek Video",
    show_image: "Show Image",
    highlight_term: "Highlight Term",
    show_procedure_step: "Show Procedure Step",
    show_tooth_comparison: "Compare Tooth Stages",
  };
  return labels[type];
}

export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
