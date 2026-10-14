import { getSpecificInfrastructure } from "@/api/infrastructure.api";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";

// Leaves a run view for the designer. The run itself is unaffected; finished runs stay in their report.
export function leaveRun() {
  const store = useCanvasStore.getState();
  store.setActiveDeploymentId(null); store.setIsDeploying(false); store.setLiveLocked(false); store.setLiveMode(false);
  // A freeform rerun can start from a challenge workspace; back in the designer the
  // canvas takes its challenge identity from the saved record, as a loaded design does.
  const layoutId = store.currentLayoutId;
  if (layoutId) void getSpecificInfrastructure(layoutId).then((design) => {
    const current = useCanvasStore.getState();
    if (current.currentLayoutId === layoutId && !current.activeDeploymentId) current.setCurrentChallengeId(design.challengeId ?? null, design.challengeVersion ?? null);
  }).catch(() => undefined);
}
