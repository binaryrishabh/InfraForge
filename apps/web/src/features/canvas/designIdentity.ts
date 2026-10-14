import { getSpecificInfrastructure } from "@/api/infrastructure.api";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { useCanvasStore } from "./store/canvasStore";

// Reopening an already loaded workspace must restore its server-owned challenge
// identity after a freeform rerun, without replacing the learner's current edits.
export async function refreshDesignIdentity(id: string) {
  const owner = useAuthStore.getState().user?.id;
  const design = await getSpecificInfrastructure(id);
  const current = useCanvasStore.getState();
  if (owner && useAuthStore.getState().user?.id === owner && current.currentLayoutId === id && !current.activeDeploymentId) {
    current.setCurrentChallengeId(design.challengeId ?? null, design.challengeVersion ?? null);
  }
}
