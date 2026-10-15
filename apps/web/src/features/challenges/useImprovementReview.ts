import { useEffect, useState } from "react";
import type { DesignChangeReview } from "@infraforge/contracts/reports";
import { previewImprovement } from "@/api/challenges.api";
import { errorMessage } from "@/api/errorMessage";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import type { ChallengeImprovementContext } from "./learningContext";

export function useImprovementReview(context: ChallengeImprovementContext | null) {
  const resources = useCanvasStore((s) => s.resources), connectionLines = useCanvasStore((s) => s.connectionLines);
  const key = context ? JSON.stringify([context, resources, connectionLines]) : "";
  const [state, setState] = useState<{ key: string; review: DesignChangeReview | null; error: string | null }>({ key: "", review: null, error: null });
  useEffect(() => {
    if (!context) return;
    let active = true;
    const timer = setTimeout(() => {
      previewImprovement(context.challengeId, context.sourceRunId, context.designId, { resources, connectionLines })
        .then((review) => { if (active) setState({ key, review, error: null }); })
        .catch((err) => { if (active) setState({ key, review: null, error: errorMessage(err, "The changes could not be reviewed.") }); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
    // The key includes every captured context/layout value. No late preview survives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { key, review: null, error: null };
}
