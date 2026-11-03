import type { NavigateFunction } from "react-router-dom";
import type { Deployment } from "@infraforge/contracts/deployment";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";

/** Opens a newly created rerun in the designer so it starts like any other run. */
export function enterCreatedRun(run: Deployment, navigate: NavigateFunction) {
  if (!run.liveTopology) throw new Error("No captured topology");
  const store = useCanvasStore.getState();
  store.loadRunTopology(run.id, run.liveTopology, run.topologyRevision, run.infrastructureId, run.runName);
  store.setIsDeploying(true); store.setLiveLocked(false);
  // A rerun is always a freeform run, even when its source was a challenge attempt.
  store.setCurrentChallengeId(null);
  navigate("/design");
}
