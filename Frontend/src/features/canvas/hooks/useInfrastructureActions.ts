import { useState } from "react";
import { toast } from "sonner";
import {
  createInfrastructure,
  deleteInfrastructure,
  updateInfrastructure,
} from "@/api/infrastructure.api";
import { createDeployment } from "@/api/deployment.api";
import { SAMPLE_ARCHITECTURE } from "@shared/constants/SAMPLE_ARCHITECTURE.constants";
import { validateDeploymentReadiness } from "@shared/validation/validateDeploymentReadiness.validation";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { ModalState } from "@shared/types/ModalState.types";
import type { UndoCanvasResourceAction } from "@shared/types/UndoCanvasResourceAction.types";
import type { WorkloadProfile } from "@shared/interface/WorkloadProfile.interface";

interface UseInfrastructureActionsProps {
  isDeploying: boolean;
  canvasResources: Resource[];
  connectionLines: ConnectionLine[];
  currentLayoutId: string | null;
  currentLayoutName: string | null;
  currentLayoutSaved: boolean;
  setCanvasResources: React.Dispatch<React.SetStateAction<Resource[]>>;
  setConnectionLines: React.Dispatch<React.SetStateAction<ConnectionLine[]>>;
  setCurrentLayoutId: (id: string | null) => void;
  setCurrentLayoutName: (name: string | null) => void;
  setCurrentLayoutSaved: (saved: boolean) => void;
  setActiveDeploymentId: (id: string | null) => void;
  setIsDeploying: (deploying: boolean) => void;
  setSelectedResource: (id: string | null) => void;
  setUndoResourcesSnapshotStackTrace: React.Dispatch<
    React.SetStateAction<UndoCanvasResourceAction[]>
  >;
  setRedoResourcesSnapshotStackTrace: (
    stack: UndoCanvasResourceAction[],
  ) => void;
  setIsInitialized: (initialized: boolean) => void;
}

export function useInfrastructureActions({
  isDeploying,
  canvasResources,
  connectionLines,
  currentLayoutId,
  currentLayoutName,
  currentLayoutSaved,
  setCanvasResources,
  setConnectionLines,
  setCurrentLayoutId,
  setCurrentLayoutName,
  setCurrentLayoutSaved,
  setActiveDeploymentId,
  setIsDeploying,
  setSelectedResource,
  setUndoResourcesSnapshotStackTrace,
  setRedoResourcesSnapshotStackTrace,
  setIsInitialized,
}: UseInfrastructureActionsProps) {
  // Set the input modal state of the canvas page
  const [modalState, setModalState] = useState<ModalState>(null);
  const [modalLoading, setModalLoading] = useState<boolean>(false);

  /* ----------------------Execute handlers (actual work, no guards, no modals)------------------ */
  const handleNewExecute = () => {
    setCanvasResources([]);
    setConnectionLines([]);
    setCurrentLayoutId(null);
    setCurrentLayoutName(null);
    setCurrentLayoutSaved(true);
    setActiveDeploymentId(null);
    setIsDeploying(false);
    setSelectedResource(null);
    setUndoResourcesSnapshotStackTrace([]);
    setRedoResourcesSnapshotStackTrace([]);
    localStorage.removeItem("Infraforge_Infrastucture_Draft");
  };

  const handleSaveWithName = async (name: string) => {
    const createdInfrastructure = await createInfrastructure(name, {
      resources: canvasResources,
      connectionLines,
    });
    setCurrentLayoutId(createdInfrastructure.id);
    setCurrentLayoutName(createdInfrastructure.name);
    setCurrentLayoutSaved(true);
    setActiveDeploymentId(null);
    setIsDeploying(false);
    setUndoResourcesSnapshotStackTrace([]);
    setRedoResourcesSnapshotStackTrace([]);
    return createdInfrastructure;
  };

  const handleUpdateWithName = async (name: string) => {
    const updatedInfrastructure = await updateInfrastructure(currentLayoutId!, {
      name,
      layout: {
        resources: canvasResources,
        connectionLines,
      },
    });
    setCurrentLayoutName(name);
    setCurrentLayoutSaved(true);
    setActiveDeploymentId(null);
    setIsDeploying(false);
    setUndoResourcesSnapshotStackTrace([]);
    setRedoResourcesSnapshotStackTrace([]);
    return updatedInfrastructure;
  };

  const handleDeleteExecute = async () => {
    const deletedInfrastructure = await deleteInfrastructure(currentLayoutId!);
    setCurrentLayoutId(null);
    setCurrentLayoutName(null);
    setCanvasResources([]);
    setConnectionLines([]);
    setCurrentLayoutSaved(true);
    setIsInitialized(false);
    setActiveDeploymentId(null);
    setIsDeploying(false);
    setSelectedResource(null);
    setUndoResourcesSnapshotStackTrace([]);
    setRedoResourcesSnapshotStackTrace([]);
    localStorage.removeItem("Infraforge_Infrastucture_Draft");
    return deletedInfrastructure;
  };

  const handleDeployExecute = async (workloadProfile?: WorkloadProfile) => {
    setActiveDeploymentId(null);
    await new Promise((r) => setTimeout(r, 100));
    const deployment = await createDeployment(
      currentLayoutId!,
      workloadProfile,
    );
    setActiveDeploymentId(deployment.id);
    setIsDeploying(true);
    setUndoResourcesSnapshotStackTrace([]);
    setRedoResourcesSnapshotStackTrace([]);
    toast.success("Deployment started");
    return deployment;
  };

  /* ----------------------Topbar buttons (guards + open modals)------------------ */
  // New canvas button
  const handleNew = () => {
    const hasRunningDeployment = isDeploying;
    const hasUnsavedChanges = !currentLayoutSaved && canvasResources.length > 0;
    // If nothing to lose, just clear immediately (no modal)
    if (!hasRunningDeployment && !hasUnsavedChanges) {
      handleNewExecute();
      return;
    }
    // Build dynamic modal state
    let title = "Discard changes?";
    let description = "You have unsaved changes on the current canvas.";
    let confirmLabel = "Clear canvas";
    let warnings: Array<{ icon: "danger" | "warning"; text: string }> = [];
    if (hasRunningDeployment && hasUnsavedChanges) {
      title = "Abort deployment and clear canvas?";
      description =
        "Starting a new canvas will affect the current deployment and unsaved changes.";
      confirmLabel = "Abort and clear";
      warnings = [
        { icon: "danger", text: "The running deployment will be aborted." },
        { icon: "danger", text: "Unsaved canvas changes will be discarded." },
      ];
    } else if (hasRunningDeployment) {
      title = "Abort deployment?";
      description = "A deployment is currently running.";
      confirmLabel = "Abort deployment";
      warnings = [
        { icon: "danger", text: "The running deployment will be aborted." },
      ];
    } else if (hasUnsavedChanges) {
      warnings = [
        { icon: "danger", text: "Unsaved canvas changes will be discarded." },
      ];
    }
    setModalState({
      type: "confirm-new",
      title,
      description,
      confirmLabel,
      warnings,
    });
  };

  // Infrastructure save button
  const handleSave = () => {
    if (isDeploying) {
      toast.warning("A deployment is in progress. Can't save.");
      return;
    }
    if (canvasResources.length === 0) {
      toast.warning("No resources on the canvas");
      return;
    }
    setModalState({ type: "save" });
  };

  // Infrastructure update button
  const handleUpdate = () => {
    if (isDeploying) {
      toast.warning("A deployment is in progress.");
      return;
    }
    if (!currentLayoutId || !currentLayoutName) {
      toast.warning("No layout loaded");
      return;
    }
    if (canvasResources.length === 0) {
      toast.warning("No resources on the canvas");
      return;
    }
    setModalState({ type: "update" });
  };

  // Infrastructure delete button
  const handleDelete = () => {
    if (isDeploying) {
      toast.warning("A deployment is in progress.");
      return;
    }
    if (!currentLayoutId) {
      toast.warning("No layout loaded to delete");
      return;
    }
    setModalState({ type: "delete" });
  };

  // Deploy button
  const handleDeploy = () => {
    if (isDeploying) {
      toast.warning("A deployment is in progress.");
      return;
    }
    if (!currentLayoutId || !currentLayoutSaved) {
      setModalState({ type: "save" });
      return;
    }
    if (canvasResources.length === 0) {
      toast.warning("Add resources to the canvas before deploying.");
      return;
    }
    // Structural readiness gate — errors block the deploy, warnings do not
    const readiness = validateDeploymentReadiness(canvasResources, connectionLines);
    if (!readiness.valid) {
      toast.error("Cannot deploy — " + readiness.errors.join(" · "));
      return;
    }
    if (readiness.warnings.length > 0) {
      readiness.warnings.forEach(w => toast.warning(w));
    }
    setModalState({ type: "confirm-deploy" });
  };

  /* ----------------Load the sample architecture hen the canvas is empty------------ */
  const loadSampleArchitecture = () => {
    setCanvasResources(SAMPLE_ARCHITECTURE.resources);
    setConnectionLines(SAMPLE_ARCHITECTURE.connectionLines);
    setCurrentLayoutSaved(false);
    setCurrentLayoutId(null);
    setCurrentLayoutName(null);
    toast.success("Sample architecture loaded");
  };

  return {
    modalState,
    setModalState,
    modalLoading,
    setModalLoading,
    handleNew,
    handleSave,
    handleUpdate,
    handleDelete,
    handleDeploy,
    handleNewExecute,
    handleSaveWithName,
    handleUpdateWithName,
    handleDeleteExecute,
    handleDeployExecute,
    loadSampleArchitecture,
  };
}