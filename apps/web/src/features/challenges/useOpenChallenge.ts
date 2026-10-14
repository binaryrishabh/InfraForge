import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { openChallengeWorkspace } from "@/api/challenges.api";
import { errorMessage } from "@/api/errorMessage";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";

/* Opens (or creates) the learner's workspace design for a challenge and hands
it to the designer through its route, which confirms before discarding work. */
export function useOpenChallenge() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (challengeId: string, fresh = false) => {
    if (useCanvasStore.getState().activeDeploymentId) { navigate("/design"); toast.info("A run is open. Stop it or return to the designer first."); return; }
    setBusy(challengeId);
    try {
      const { designId } = await openChallengeWorkspace(challengeId, fresh);
      navigate(`/design?design=${encodeURIComponent(designId)}`);
    } catch (error) { toast.error(errorMessage(error, "The challenge workspace could not be opened.")); }
    finally { setBusy(null); }
  };
  return { open, busy };
}
