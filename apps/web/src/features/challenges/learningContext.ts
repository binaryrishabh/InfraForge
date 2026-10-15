import { useLocation } from "react-router-dom";
import { HYPOTHESIS_MAX } from "@infraforge/contracts/challenges";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";

export interface ChallengeImprovementContext {
  ownerId: string; designId: string; sourceRunId: string; challengeId: string; version: number; hypothesis: string;
}
// Draft intent stays in this browser history entry, never a query string or a
// global journal. It becomes durable only when the new attempt is inserted.
export function readLearningContext(state: unknown, ownerId: string | undefined, designId: string | null): ChallengeImprovementContext | null {
  const c = (state as { challengeImprovement?: Partial<ChallengeImprovementContext> } | null)?.challengeImprovement;
  return c && c.ownerId === ownerId && !!ownerId && c.designId === designId && typeof c.sourceRunId === "string" &&
    typeof c.challengeId === "string" && Number.isInteger(c.version) && c.version! > 0 && typeof c.hypothesis === "string" &&
    c.hypothesis.trim().length > 0 && c.hypothesis.length <= HYPOTHESIS_MAX ? c as ChallengeImprovementContext : null;
}
export function useChallengeImprovement() {
  const location = useLocation(), owner = useAuthStore((s) => s.user?.id), design = useCanvasStore((s) => s.currentLayoutId);
  return readLearningContext(location.state, owner, design);
}
