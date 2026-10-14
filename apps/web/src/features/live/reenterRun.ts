import { getSpecificDeployment } from "@/api/deployment.api";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";

/* Re-open a live run in the designer with its accepted live topology. */
export async function reenterRun(deploymentId: string, name: string) {
  const run = await getSpecificDeployment(deploymentId);
  if (run.status !== "live" || !run.liveTopology) throw new Error("This run is no longer live.");
  const store = useCanvasStore.getState();
  store.loadRunTopology(run.id, run.liveTopology, run.topologyRevision, run.infrastructureId, name);
  store.setLiveLocked(!!run.challengeId);
  store.setCurrentChallengeId(run.challengeId ?? null);
  store.setCurrentLayoutSaved(!!run.challengeId);
}
