import { useCallback, useEffect } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { useCanvasPersistence } from "./useCanvasPersistence";
import { useInfrastructureDropdown } from "./useInfrastructureDropdown";
import { useCanvasUndoRedo } from "./useCanvasUndoRedo";
import { useCanvasKeyboardShortcuts } from "./useCanvasKeyboardShortcuts";
import { useCanvasConnections } from "./useCanvasConnections";
import { useCanvasResourceActions } from "./useCanvasResourceActions";
import { useInfrastructureActions } from "./useInfrastructureActions";
import { useCanvasDragDrop } from "./useCanvasDragDrop";

export function useCanvasDesignerController() {
  // Core canvas state — ONE source of truth, read from useCanvasStore
  const canvasResources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const currentLayoutId = useCanvasStore((s) => s.currentLayoutId);
  const currentLayoutName = useCanvasStore((s) => s.currentLayoutName);
  const currentLayoutSaved = useCanvasStore((s) => s.currentLayoutSaved);
  const activeDeploymentId = useCanvasStore((s) => s.activeDeploymentId);
  const isDeploying = useCanvasStore((s) => s.isDeploying);
  const selectedResourceForConfig = useCanvasStore((s) => s.selectedResourceForConfigId);
  const emptyCanvasStateDismissed = useCanvasStore((s) => s.emptyCanvasStateDismissed);
  const selectedResource = useCanvasStore((s) => s.selectedResourceId);
  const isConnecting = useCanvasStore((s) => s.isConnecting);

  // Store actions — passed down to sub-hooks. They accept a value OR an updater
  // function, so every existing prev => ... call site keeps working unchanged.
  const setResources = useCanvasStore((s) => s.setResources);
  const setConnectionLines = useCanvasStore((s) => s.setConnectionLines);
  const setCurrentLayoutId = useCanvasStore((s) => s.setCurrentLayoutId);
  const setCurrentLayoutName = useCanvasStore((s) => s.setCurrentLayoutName);
  const setCurrentLayoutSaved = useCanvasStore((s) => s.setCurrentLayoutSaved);
  const setSelectedResourceId = useCanvasStore((s) => s.setSelectedResourceId);
  const setActiveDeploymentId = useCanvasStore((s) => s.setActiveDeploymentId);
  const setIsDeploying = useCanvasStore((s) => s.setIsDeploying);
  const setEmptyCanvasStateDismissed = useCanvasStore((s) => s.setEmptyCanvasStateDismissed);
  const setSelectedResourceForConfigId = useCanvasStore((s) => s.setSelectedResourceForConfigId);

  /* ------------------Config panel---------------------- */
  // Stable identity (useCallback + []) so CanvasResourceItem's memo can skip repaints.
  const handleResourceDoubleClickShowConfig = useCallback((resourceId: string) => {
    useCanvasStore.getState().setSelectedResourceForConfigId(resourceId);
  }, []);

  // close the config by clicking anywhere except the config panel itself.
  useEffect(() => {
    const handleClickOutsideConfigPanel = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".config-panel-container")) {
        useCanvasStore.getState().setSelectedResourceForConfigId(null);
      }
    };
    if (selectedResourceForConfig) {
      document.addEventListener("click", handleClickOutsideConfigPanel);
    }
    return () =>
      document.removeEventListener("click", handleClickOutsideConfigPanel);
  }, [selectedResourceForConfig]);

  // --- Compose all extracted hooks ---
  const persistence = useCanvasPersistence();

  const undoRedo = useCanvasUndoRedo({
    isDeploying,
    canvasResources,
    setCanvasResources: setResources,
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

  const dropdown = useInfrastructureDropdown({
    isDeploying,
    setCurrentLayoutId,
    setCurrentLayoutName,
    setCanvasResources: setResources,
    setConnectionLines,
    setCurrentLayoutSaved,
    setShowLayoutDropdown: () => {},
    setActiveDeploymentId,
    setIsDeploying,
    setSelectedResource: setSelectedResourceId,
    setUndoResourcesSnapshotStackTrace:
      undoRedo.setUndoResourcesSnapshotStackTrace,
    setRedoResourcesSnapshotStackTrace:
      undoRedo.setRedoResourcesSnapshotStackTrace,
  });

  const resourceActions = useCanvasResourceActions({
    isDeploying,
    canvasResources,
    connectionLines,
    currentLayoutSaved,
    setCanvasResources: setResources,
    setConnectionLines,
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
    connectionLines,
    currentLayoutId,
    currentLayoutName,
    currentLayoutSaved,
    setCanvasResources: setResources,
    setConnectionLines,
    setCurrentLayoutId,
    setCurrentLayoutName,
    setCurrentLayoutSaved,
    setActiveDeploymentId,
    setIsDeploying,
    setSelectedResource: setSelectedResourceId,
    setUndoResourcesSnapshotStackTrace:
      undoRedo.setUndoResourcesSnapshotStackTrace,
    setRedoResourcesSnapshotStackTrace:
      undoRedo.setRedoResourcesSnapshotStackTrace,
    setIsInitialized: persistence.setIsInitialized,
  });

  const dragDrop = useCanvasDragDrop({
    canvasResources,
    setCanvasResources: setResources,
    setCurrentLayoutSaved,
    setIsInitialized: persistence.setIsInitialized,
    setUndoResourcesSnapshotStackTrace:
      undoRedo.setUndoResourcesSnapshotStackTrace,
    setRedoResourcesSnapshotStackTrace:
      undoRedo.setRedoResourcesSnapshotStackTrace,
    currentLayoutSaved,
  });

  return {
    // Core state (sourced from the store)
    canvasResources,
    connectionLines,
    currentLayoutId,
    currentLayoutName,
    currentLayoutSaved,
    activeDeploymentId,
    setActiveDeploymentId,
    isDeploying,
    setIsDeploying,
    selectedResourceForConfig,
    setSelectedResourceForConfig: setSelectedResourceForConfigId,
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
    selectedResource,
    isConnecting,
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
    // Drag & Drop (activeDrag removed — now read directly from store in CanvasDesignerPage)
    sensors: dragDrop.sensors,
    onDragStart: dragDrop.onDragStart,
    onDragEnd: dragDrop.onDragEnd,
    // Config panel
    handleResourceDoubleClickShowConfig,
  };
}