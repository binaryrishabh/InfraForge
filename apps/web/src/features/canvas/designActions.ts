import { toast } from "sonner";
import { SAMPLE_ARCHITECTURE } from "@infraforge/domain/examples";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import { createInfrastructure, deleteInfrastructure, updateInfrastructure } from "@/api/infrastructure.api";
import { createDeployment } from "@/api/deployment.api";
import { createRerun } from "@/api/reports.api";
import { useAuthStore } from "../auth/store/auth.store";
import { draftKey } from "../auth/drafts";
import { useCanvasStore } from "./store/canvasStore";
import { CARD_LAYOUT_VERSION } from "./utils/layoutMigration";
import type { CanvasRerunRequest } from "./improvement";

const layoutOf = () => {
  const { resources, connectionLines } = useCanvasStore.getState();
  return { resources, connectionLines, layoutVersion: CARD_LAYOUT_VERSION };
};
const ownerGuard = () => {
  const owner = useAuthStore.getState().user?.id;
  if (!owner) throw new Error("Your session ended.");
  return () => { if (useAuthStore.getState().user?.id !== owner) throw new Error("Your session changed."); };
};
const forgetDraft = () => {
  const userId = useAuthStore.getState().user?.id;
  try { if (userId) localStorage.removeItem(draftKey(userId)); } catch { /* storage unavailable */ }
};

export function clearDesign() {
  const store = useCanvasStore.getState();
  store.clearCanvas();
  store.setIsInitialized(true);
  store.setEmptyCanvasStateDismissed(false);
  forgetDraft();
}

// New design: confirm first when unsaved work would be lost.
export function requestNewDesign() {
  const store = useCanvasStore.getState();
  if (store.isDeploying) { toast.warning("Wait for the run to start before clearing the canvas."); return; }
  if (store.currentLayoutSaved || store.resources.length === 0) { clearDesign(); return; }
  store.setModalState({ type: "confirm-new", title: "Discard unsaved changes?", description: "Starting a new design clears the canvas.",
    confirmLabel: "Discard and start new", warnings: ["Unsaved changes to the current design are lost."] });
}

export async function saveAsNew(name: string) {
  const check = ownerGuard();
  const created = await createInfrastructure(name, layoutOf());
  check();
  const store = useCanvasStore.getState();
  store.setCurrentLayoutId(created.id); store.setCurrentLayoutName(created.name);
  // A copy is always a freeform design; challenge workspaces are created by the server.
  store.setCurrentChallengeId(null);
  store.setCurrentLayoutSaved(true);
  return created;
}

export async function saveDesign() {
  const store = useCanvasStore.getState();
  if (!store.currentLayoutId) { store.setModalState({ type: "save" }); return null; }
  const check = ownerGuard();
  const updated = await updateInfrastructure(store.currentLayoutId, { layout: layoutOf() });
  check();
  useCanvasStore.getState().setCurrentLayoutSaved(true);
  return updated;
}

export async function renameDesign(name: string) {
  const store = useCanvasStore.getState();
  if (!store.currentLayoutId) return null;
  const check = ownerGuard();
  const updated = await updateInfrastructure(store.currentLayoutId, { name });
  check();
  useCanvasStore.getState().setCurrentLayoutName(updated.name);
  return updated;
}

export async function deleteDesign() {
  const store = useCanvasStore.getState();
  if (!store.currentLayoutId) return;
  await deleteInfrastructure(store.currentLayoutId);
  clearDesign();
}

export function loadSampleArchitecture() {
  const store = useCanvasStore.getState();
  store.clearCanvas();
  store.setResources(SAMPLE_ARCHITECTURE.resources);
  store.setConnectionLines(SAMPLE_ARCHITECTURE.connectionLines);
  store.setCurrentLayoutSaved(false);
  store.setIsInitialized(true);
}

// Opens the run dialog only when the design can pass validation.
export function requestRun() {
  const store = useCanvasStore.getState();
  if (store.isDeploying) { toast.warning("A run is already starting."); return; }
  if (store.resources.length === 0) { toast.warning("Add resources to the canvas before running."); return; }
  const readiness = validateDeploymentReadiness(store.resources, store.connectionLines);
  if (!readiness.valid) { toast.error(`Fix the design first: ${readiness.errors[0]}`); return; }
  store.setModalState({ type: store.currentChallengeId ? "attempt" : "confirm-deploy" });
}

/* A run always captures exactly the canvas: it is saved under the given name
first (created or updated), then the run is created from that saved design. */
export async function runDesign(workload: WorkloadProfile | undefined, name: string, match?: CanvasRerunRequest) {
  const check = ownerGuard();
  const store = useCanvasStore.getState();
  if (match && (store.activeDeploymentId || store.currentLayoutId !== match.designId ||
      store.resources !== match.layout.resources || store.connectionLines !== match.layout.connectionLines)) throw new Error("The canvas changed since the preview.");
  const layout = layoutOf();
  let designId = store.currentLayoutId;
  if (!designId) {
    const created = await createInfrastructure(name, layout);
    check();
    designId = created.id;
    store.setCurrentLayoutId(created.id); store.setCurrentLayoutName(created.name);
  } else {
    await updateInfrastructure(designId, { name, layout });
    check();
    store.setCurrentLayoutName(name);
  }
  store.setCurrentLayoutSaved(true);
  const run = match ? await createRerun(match.sourceId, "current-design", match.matchedStop, match.inputHash) : await createDeployment(designId, workload);
  check();
  if (!run.liveTopology) throw new Error("The run has no captured topology.");
  const current = useCanvasStore.getState();
  current.loadRunTopology(run.id, run.liveTopology, run.topologyRevision, designId, name);
  current.setCurrentLayoutSaved(true);
  current.setIsDeploying(true);
  current.setLiveLocked(false);
  return run;
}
