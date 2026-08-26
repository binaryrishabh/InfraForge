import { useEffect, useState } from "react";
import { useCanvasPersistence } from "./useCanvasPersistence";
import { useInfrastructureDropdown } from "./useInfrastructureDropdown";
import { useCanvasUndoRedo } from "./useCanvasUndoRedo";
import { useCanvasKeyboardShortcuts } from "./useCanvasKeyboardShortcuts";
import { useCanvasConnections } from "./useCanvasConnections";
import { useCanvasResourceActions } from "./useCanvasResourceActions";
import { useInfrastructureActions } from "./useInfrastructureActions";
import { useCanvasDragDrop } from "./useCanvasDragDrop";
import type { Resource } from "@shared/types/Resource.types";
import type { ConnectionLine } from "@shared/types/ConnectionLine.types";

export function useCanvasDesignerController() {
  // Core canvas state (owned by controller)
  const [canvasResources, setCanvasResources] = useState<Array<Resource>>([]);
  const [connectionLines, setConnectionLines] = useState<Array<ConnectionLine>>(
    [],
  );
  // states about current state of layout on canvas
  const [currentLayoutId, setCurrentLayoutId] = useState<string | null>(null);
  const [currentLayoutName, setCurrentLayoutName] = useState<string | null>(
    null,
  );
  const [currentLayoutSaved, setCurrentLayoutSaved] = useState<boolean>(true);
  // set the deployment status when deploy button is clicked
  const [activeDeploymentId, setActiveDeploymentId] = useState<string | null>(
    null,
  );
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  // On clicking the resources on canavs -> a side panel opens showing there details/config...
  const [selectedResourceForConfig, setSelectedResourceForConfig] = useState<
    string | null
  >(null);
  // This for the dismiss button next to the LoadSampleArchitecture
  const [emptyCanvasStateDismissed, setEmptyCanvasStateDismissed] =
    useState<boolean>(false);

  /* ------------------Config panel---------------------- */
  const handleResourceDoubleClickShowConfig = (resourceId: string) => {
    setSelectedResourceForConfig(resourceId);
  };

  // close the config by clicking anywhere except the config panel itself.
  useEffect(() => {
    const handleClickOutsideConfigPanel = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".config-panel-container")) {
        setSelectedResourceForConfig(null);
      }
    };
    if (selectedResourceForConfig) {
      document.addEventListener("click", handleClickOutsideConfigPanel);
    }
    return () =>
      document.removeEventListener("click", handleClickOutsideConfigPanel);
  }, [selectedResourceForConfig]);

  // --- Compose all extracted hooks ---
  const persistence = useCanvasPersistence({
    canvasResources,
    connectionLines,
    currentLayoutId,
    currentLayoutName,
    currentLayoutSaved,
    setCanvasResources,
    setCurrentLayoutId,
    setCurrentLayoutName,
    setCurrentLayoutSaved,
    setConnectionLines,
  });

  const undoRedo = useCanvasUndoRedo({
    isDeploying,
    canvasResources,
    setCanvasResources,
    connectionLines,
    setConnectionLines,
    setCurrentLayoutSaved,
  });

  useCanvasKeyboardShortcuts({
    handleUndoRef: undoRedo.handleUndoRef,
    handleRedoRef: undoRedo.handleRedoRef,
  });

  const connections = useCanvasConnections({
    canvasResources,
    setCurrentLayoutSaved,
    setRedoResourcesSnapshotStackTrace:
      undoRedo.setRedoResourcesSnapshotStackTrace,
  });

  // Sync connectionLines from connections hook back to controller state
  // This is needed because useCanvasConnections owns its own connectionLines state
  // In Phase C wiring, we will unify this properly
  useEffect(() => {
    setConnectionLines(connections.connectionLines);
  }, [connections.connectionLines]);

  const dropdown = useInfrastructureDropdown({
    isDeploying,
    setCurrentLayoutId,
    setCurrentLayoutName,
    setCanvasResources,
    setConnectionLines: connections.setConnectionLines,
    setCurrentLayoutSaved,
    setShowLayoutDropdown: () => {},
    setActiveDeploymentId,
    setIsDeploying,
    setSelectedResource: connections.setSelectedResource,
    setUndoResourcesSnapshotStackTrace:
      undoRedo.setUndoResourcesSnapshotStackTrace,
    setRedoResourcesSnapshotStackTrace:
      undoRedo.setRedoResourcesSnapshotStackTrace,
  });

  const resourceActions = useCanvasResourceActions({
    isDeploying,
    canvasResources,
    connectionLines: connections.connectionLines,
    currentLayoutSaved,
    setCanvasResources,
    setConnectionLines: connections.setConnectionLines,
    setCurrentLayoutSaved,
    setUndoResourcesSnapshotStackTrace:
      undoRedo.setUndoResourcesSnapshotStackTrace,
    setRedoResourcesSnapshotStackTrace:
      undoRedo.setRedoResourcesSnapshotStackTrace,
    handleUndoRef: undoRedo.handleUndoRef,
  });

  const infrastructureActions = useInfrastructureActions({
    isDeploying,
    canvasResources,
    connectionLines: connections.connectionLines,
    currentLayoutId,
    currentLayoutName,
    currentLayoutSaved,
    setCanvasResources,
    setConnectionLines: connections.setConnectionLines,
    setCurrentLayoutId,
    setCurrentLayoutName,
    setCurrentLayoutSaved,
    setActiveDeploymentId,
    setIsDeploying,
    setSelectedResource: connections.setSelectedResource,
    setUndoResourcesSnapshotStackTrace:
      undoRedo.setUndoResourcesSnapshotStackTrace,
    setRedoResourcesSnapshotStackTrace:
      undoRedo.setRedoResourcesSnapshotStackTrace,
    setIsInitialized: persistence.setIsInitialized,
  });

  const dragDrop = useCanvasDragDrop({
    canvasResources,
    setCanvasResources,
    setCurrentLayoutSaved,
    setIsInitialized: persistence.setIsInitialized,
    setUndoResourcesSnapshotStackTrace:
      undoRedo.setUndoResourcesSnapshotStackTrace,
    setRedoResourcesSnapshotStackTrace:
      undoRedo.setRedoResourcesSnapshotStackTrace,
    currentLayoutSaved,
  });

  return {
    // Core state
    canvasResources,
    currentLayoutId,
    currentLayoutName,
    currentLayoutSaved,
    activeDeploymentId,
    setActiveDeploymentId,
    isDeploying,
    setIsDeploying,
    selectedResourceForConfig,
    setSelectedResourceForConfig,
    emptyCanvasStateDismissed,
    setEmptyCanvasStateDismissed,
    // Persistence
    isInitialized: persistence.isInitialized,
    // Dropdown
    showLayoutDropdown: dropdown.showLayoutDropdown,
    savedLayouts: dropdown.savedLayouts,
    handleOpenCloseDropDownNameClick: dropdown.handleOpenCloseDropDownNameClick,
    handleSelectLayout: dropdown.handleSelectLayout,
    // Connections
    connectionLines: connections.connectionLines,
    selectedResource: connections.selectedResource,
    isConnecting: connections.isConnecting,
    hanldeResouceClick: connections.hanldeResouceClick,
    handleToggleConnectionLines: connections.handleToggleConnectionLines,
    // Undo/Redo
    undoResourcesSnapshotStackTrace: undoRedo.undoResourcesSnapshotStackTrace,
    redoResourcesSnapshotStackTrace: undoRedo.redoResourcesSnapshotStackTrace,
    // Resource actions
    handleDeleteCanvasResource: resourceActions.handleDeleteCanvasResource,
    handleUpdateCanvasResource: resourceActions.handleUpdateCanvasResource,
    // Infrastructure actions
    modalState: infrastructureActions.modalState,
    setModalState: infrastructureActions.setModalState,
    modalLoading: infrastructureActions.modalLoading,
    setModalLoading: infrastructureActions.setModalLoading,
    handleNew: infrastructureActions.handleNew,
    handleSave: infrastructureActions.handleSave,
    handleUpdate: infrastructureActions.handleUpdate,
    handleDelete: infrastructureActions.handleDelete,
    handleDeploy: infrastructureActions.handleDeploy,
    handleNewExecute: infrastructureActions.handleNewExecute,
    handleSaveWithName: infrastructureActions.handleSaveWithName,
    handleUpdateWithName: infrastructureActions.handleUpdateWithName,
    handleDeleteExecute: infrastructureActions.handleDeleteExecute,
    handleDeployExecute: infrastructureActions.handleDeployExecute,
    loadSampleArchitecture: infrastructureActions.loadSampleArchitecture,
    // Drag & Drop
    sensors: dragDrop.sensors,
    activeDrag: dragDrop.activeDrag,
    onDragStart: dragDrop.onDragStart,
    onDragEnd: dragDrop.onDragEnd,
    // Config panel
    handleResourceDoubleClickShowConfig,
  };
}