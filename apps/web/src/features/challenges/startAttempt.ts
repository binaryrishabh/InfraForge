import type { ChallengeBrief, ChallengePrediction } from "@infraforge/contracts/challenges";
import { startChallengeAttempt } from "@/api/challenges.api";
import { updateInfrastructure } from "@/api/infrastructure.api";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import { CARD_LAYOUT_VERSION } from "@/features/canvas/utils/layoutMigration";

/* Saves the exact canvas to the challenge workspace, then asks the server to
create the attempt. The server supplies the workload, seed, evaluation time and
rules; the client sends only the design id and the prediction. */
export async function startAttempt(brief: ChallengeBrief, prediction: ChallengePrediction) {
  const store = useCanvasStore.getState();
  const owner = useAuthStore.getState().user?.id;
  const designId = store.currentLayoutId;
  if (!owner || !designId || store.currentChallengeId !== brief.id) throw new Error("Open this challenge's workspace design before starting an attempt.");
  const { resources, connectionLines } = store;
  if (!store.currentLayoutSaved) {
    await updateInfrastructure(designId, { layout: { resources, connectionLines, layoutVersion: CARD_LAYOUT_VERSION } });
    if (useAuthStore.getState().user?.id !== owner) throw new Error("Your session changed.");
    useCanvasStore.getState().setCurrentLayoutSaved(true);
  }
  const run = await startChallengeAttempt(brief.id, designId, prediction);
  if (useAuthStore.getState().user?.id !== owner) throw new Error("Your session changed.");
  if (!run.liveTopology) throw new Error("The attempt has no captured topology.");
  const current = useCanvasStore.getState();
  current.loadRunTopology(run.id, run.liveTopology, run.topologyRevision, designId, current.currentLayoutName);
  // The attempt captured exactly the saved workspace layout.
  current.setCurrentLayoutSaved(true);
  current.setIsDeploying(true);
  current.setLiveLocked(true);
  return run;
}
