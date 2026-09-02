import { toast } from "sonner";
import { createInfrastructure, deleteInfrastructure, updateInfrastructure } from "@/api/infrastructure.api";
import { createDeployment } from "@/api/deployment.api";
import { SAMPLE_ARCHITECTURE } from "@shared/constants/SAMPLE_ARCHITECTURE.constants";
import { validateDeploymentReadiness } from "@shared/validation/validateDeploymentReadiness.validation";
import { useCanvasStore } from "../store/canvasStore";
import type { WorkloadProfile } from "@shared/interface/WorkloadProfile.interface";

export function useInfrastructureActions() {
  const modalState = useCanvasStore((s) => s.modalState);
  const modalLoading = useCanvasStore((s) => s.modalLoading);

  const handleNewExecute = () => {
    const store = useCanvasStore.getState();
    store.setResources([]);
    store.setConnectionLines([]);
    store.setCurrentLayoutId(null);
    store.setCurrentLayoutName(null);
    store.setCurrentLayoutSaved(true);
    store.setActiveDeploymentId(null);
    store.setIsDeploying(false);
    store.setSelectedResourceId(null);
    store.setUndoStack([]);
    store.setRedoStack([]);
    localStorage.removeItem("Infraforge_Infrastucture_Draft");
  };

  const handleSaveWithName = async (name: string) => {
    const store = useCanvasStore.getState();
    const createdInfrastructure = await createInfrastructure(name, {
      resources: store.resources,
      connectionLines: store.connectionLines,
    });
    store.setCurrentLayoutId(createdInfrastructure.id);
    store.setCurrentLayoutName(createdInfrastructure.name);
    store.setCurrentLayoutSaved(true);
    store.setActiveDeploymentId(null);
    store.setIsDeploying(false);
    store.setUndoStack([]);
    store.setRedoStack([]);
    return createdInfrastructure;
  };

  const handleUpdateWithName = async (name: string) => {
    const store = useCanvasStore.getState();
    const updatedInfrastructure = await updateInfrastructure(store.currentLayoutId!, {
      name,
      layout: { resources: store.resources, connectionLines: store.connectionLines },
    });
    store.setCurrentLayoutName(name);
    store.setCurrentLayoutSaved(true);
    store.setActiveDeploymentId(null);
    store.setIsDeploying(false);
    store.setUndoStack([]);
    store.setRedoStack([]);
    return updatedInfrastructure;
  };

  const handleDeleteExecute = async () => {
    const store = useCanvasStore.getState();
    const deletedInfrastructure = await deleteInfrastructure(store.currentLayoutId!);
    store.setCurrentLayoutId(null);
    store.setCurrentLayoutName(null);
    store.setResources([]);
    store.setConnectionLines([]);
    store.setCurrentLayoutSaved(true);
    store.setIsInitialized(false);
    store.setActiveDeploymentId(null);
    store.setIsDeploying(false);
    store.setSelectedResourceId(null);
    store.setUndoStack([]);
    store.setRedoStack([]);
    localStorage.removeItem("Infraforge_Infrastucture_Draft");
    return deletedInfrastructure;
  };

  const handleDeployExecute = async (workloadProfile?: WorkloadProfile) => {
    const store = useCanvasStore.getState();
    store.setActiveDeploymentId(null);
    await new Promise((r) => setTimeout(r, 100));
    const deployment = await createDeployment(store.currentLayoutId!, workloadProfile);
    store.setActiveDeploymentId(deployment.id);
    store.setIsDeploying(true);
    store.setUndoStack([]);
    store.setRedoStack([]);
    toast.success("Deployment started");
    return deployment;
  };

  const handleNew = () => {
    const store = useCanvasStore.getState();
    const hasRunningDeployment = store.isDeploying;
    const hasUnsavedChanges = !store.currentLayoutSaved && store.resources.length > 0;
    if (!hasRunningDeployment && !hasUnsavedChanges) { handleNewExecute(); return; }
    let title = "Discard changes?";
    let description = "You have unsaved changes on the current canvas.";
    let confirmLabel = "Clear canvas";
    let warnings: Array<{ icon: "danger" | "warning"; text: string }> = [];
    if (hasRunningDeployment && hasUnsavedChanges) {
      title = "Abort deployment and clear canvas?";
      description = "Starting a new canvas will affect the current deployment and unsaved changes.";
      confirmLabel = "Abort and clear";
      warnings = [
        { icon: "danger", text: "The running deployment will be aborted." },
        { icon: "danger", text: "Unsaved canvas changes will be discarded." },
      ];
    } else if (hasRunningDeployment) {
      title = "Abort deployment?"; description = "A deployment is currently running.";
      confirmLabel = "Abort deployment";
      warnings = [{ icon: "danger", text: "The running deployment will be aborted." }];
    } else if (hasUnsavedChanges) {
      warnings = [{ icon: "danger", text: "Unsaved canvas changes will be discarded." }];
    }
    store.setModalState({ type: "confirm-new", title, description, confirmLabel, warnings });
  };

  const handleSave = () => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) { toast.warning("A deployment is in progress. Can't save."); return; }
    if (store.resources.length === 0) { toast.warning("No resources on the canvas"); return; }
    store.setModalState({ type: "save" });
  };

  const handleUpdate = () => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) { toast.warning("A deployment is in progress."); return; }
    if (!store.currentLayoutId || !store.currentLayoutName) { toast.warning("No layout loaded"); return; }
    if (store.resources.length === 0) { toast.warning("No resources on the canvas"); return; }
    store.setModalState({ type: "update" });
  };

  const handleDelete = () => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) { toast.warning("A deployment is in progress."); return; }
    if (!store.currentLayoutId) { toast.warning("No layout loaded to delete"); return; }
    store.setModalState({ type: "delete" });
  };

  const handleDeploy = () => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) { toast.warning("A deployment is in progress."); return; }
    if (!store.currentLayoutId || !store.currentLayoutSaved) { store.setModalState({ type: "save" }); return; }
    if (store.resources.length === 0) { toast.warning("Add resources to the canvas before deploying."); return; }
    const readiness = validateDeploymentReadiness(store.resources, store.connectionLines);
    if (!readiness.valid) { toast.error("Cannot deploy — " + readiness.errors.join(" · ")); return; }
    if (readiness.warnings.length > 0) readiness.warnings.forEach(w => toast.warning(w));
    store.setModalState({ type: "confirm-deploy" });
  };

  const loadSampleArchitecture = () => {
    const store = useCanvasStore.getState();
    store.setResources(SAMPLE_ARCHITECTURE.resources);
    store.setConnectionLines(SAMPLE_ARCHITECTURE.connectionLines);
    store.setCurrentLayoutSaved(false);
    store.setCurrentLayoutId(null);
    store.setCurrentLayoutName(null);
    toast.success("Sample architecture loaded");
  };

  return {
    modalState, modalLoading, handleNew, handleSave, handleUpdate, handleDelete, handleDeploy,
    handleNewExecute, handleSaveWithName, handleUpdateWithName, handleDeleteExecute, handleDeployExecute, loadSampleArchitecture,
  };
}