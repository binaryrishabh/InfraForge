import { getSpecificDeployment } from "@/api/deployment.api";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import { useAuthStore } from "@/features/auth/store/auth.store";

/* Re-open a live run in the designer with its accepted live topology. */
export async function reenterRun(deploymentId: string, name = "Run", signal?: AbortSignal) {
  const owner = useAuthStore.getState().user?.id;
  const run = await getSpecificDeployment(deploymentId);
  if (signal?.aborted || !owner || useAuthStore.getState().user?.id !== owner) return;
  if (run.status !== "live" || !run.liveTopology) throw new Error("This run is no longer live.");
  const store = useCanvasStore.getState();
  store.loadRunTopology(run.id, run.liveTopology, run.topologyRevision, run.infrastructureId, run.runName ?? name);
  store.setLiveLocked(!!run.challengeId);
  store.setCurrentChallengeId(run.challengeId ?? null, run.challengeVersion ?? null);
  store.setCurrentLayoutSaved(!!run.challengeId);
}
