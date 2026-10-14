import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { openChallengeWorkspace } from "@/api/challenges.api";
import { errorMessage } from "@/api/errorMessage";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import { leaveRun } from "@/features/live/leaveRun";

/* Opens (or creates) the learner's workspace design for a challenge and hands
it to the designer through its route, which confirms before discarding work. */
export function useOpenChallenge() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (challengeId: string, options: { fresh?: boolean; copyFrom?: string } = {}) => {
    const store = useCanvasStore.getState();
    // A live or starting run keeps the designer; a finished one is left behind in its report.
    if (store.activeDeploymentId && (store.liveMode || store.isDeploying)) { navigate("/design"); toast.info("A run is still going. Stop it or return to the designer first."); return; }
    if (store.activeDeploymentId) leaveRun();
    setBusy(challengeId);
    try {
      const { designId } = await openChallengeWorkspace(challengeId, options);
      navigate(`/design?design=${encodeURIComponent(designId)}`);
    } catch (error) { toast.error(errorMessage(error, "The challenge workspace could not be opened.")); }
    finally { setBusy(null); }
  };
  return { open, busy };
}
