import { create } from "zustand";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import type { Infrastructure } from "@shared/interface/Infrastructure.interface";
import type { ModalState } from "@shared/types/ModalState.types";
import type { UndoCanvasResourceAction } from "@shared/types/UndoCanvasResourceAction.types";

type Updater<T> = T | ((prev: T) => T);

interface CanvasStoreState {
  // Layout
  resources: Resource[];
  connectionLines: ConnectionLine[];
  // Layout metadata
  currentLayoutId: string | null;
  currentLayoutName: string | null;
  currentLayoutSaved: boolean;
  // Interaction
  selectedResourceId: string | null;
  selectedResourceForConfigId: string | null;
  isConnecting: boolean;
  // Deployment
  activeDeploymentId: string | null;
  isDeploying: boolean;
  // Empty state
  emptyCanvasStateDismissed: boolean;
  // Drag
  activeDrag: { label: ResourceType } | null;
  // Dropdown
  showLayoutDropdown: boolean;
  savedLayouts: Infrastructure[];
  // Modals
  modalState: ModalState;
  modalLoading: boolean;
  // Undo/Redo
  undoStack: UndoCanvasResourceAction[];
  redoStack: UndoCanvasResourceAction[];
  // Persistence
  isInitialized: boolean;
  
  // Actions
  setResources: (updater: Updater<Resource[]>) => void;
  setConnectionLines: (updater: Updater<ConnectionLine[]>) => void;
  setCurrentLayoutId: (id: string | null) => void;
  setCurrentLayoutName: (name: string | null) => void;
  setCurrentLayoutSaved: (saved: boolean) => void;
  setSelectedResourceId: (id: string | null) => void;
  setSelectedResourceForConfigId: (id: string | null) => void;
  setIsConnecting: (connecting: boolean) => void;
  setActiveDeploymentId: (id: string | null) => void;
  setIsDeploying: (deploying: boolean) => void;
  setEmptyCanvasStateDismissed: (dismissed: boolean) => void;
  setActiveDrag: (drag: { label: ResourceType } | null) => void;
  setShowLayoutDropdown: (show: boolean) => void;
  setSavedLayouts: (layouts: Infrastructure[]) => void;
  setModalState: (state: ModalState) => void;
  setModalLoading: (loading: boolean) => void;
  setUndoStack: (updater: Updater<UndoCanvasResourceAction[]>) => void;
  setRedoStack: (updater: Updater<UndoCanvasResourceAction[]>) => void;
  setIsInitialized: (initialized: boolean) => void;
  loadLayout: (resources: Resource[], connectionLines: ConnectionLine[], id: string | null, name: string | null) => void;
  clearCanvas: () => void;
}

export const useCanvasStore = create<CanvasStoreState>()((set) => ({
  resources: [],
  connectionLines: [],
  currentLayoutId: null,
  currentLayoutName: null,
  currentLayoutSaved: true,
  selectedResourceId: null,
  selectedResourceForConfigId: null,
  isConnecting: false,
  activeDeploymentId: null,
  isDeploying: false,
  emptyCanvasStateDismissed: false,
  activeDrag: null,
  showLayoutDropdown: false,
  savedLayouts: [],
  modalState: null,
  modalLoading: false,
  undoStack: [],
  redoStack: [],
  isInitialized: false,

  setResources: (updater) => set((s) => ({ resources: typeof updater === "function" ? updater(s.resources) : updater })),
  setConnectionLines: (updater) => set((s) => ({ connectionLines: typeof updater === "function" ? updater(s.connectionLines) : updater })),
  setCurrentLayoutId: (id) => set({ currentLayoutId: id }),
  setCurrentLayoutName: (name) => set({ currentLayoutName: name }),
  setCurrentLayoutSaved: (saved) => set({ currentLayoutSaved: saved }),
  setSelectedResourceId: (id) => set({ selectedResourceId: id }),
  setSelectedResourceForConfigId: (id) => set({ selectedResourceForConfigId: id }),
  setIsConnecting: (connecting) => set({ isConnecting: connecting }),
  setActiveDeploymentId: (id) => set({ activeDeploymentId: id }),
  setIsDeploying: (deploying) => set({ isDeploying: deploying }),
  setEmptyCanvasStateDismissed: (dismissed) => set({ emptyCanvasStateDismissed: dismissed }),
  setActiveDrag: (drag) => set({ activeDrag: drag }),
  setShowLayoutDropdown: (show) => set({ showLayoutDropdown: show }),
  setSavedLayouts: (layouts) => set({ savedLayouts: layouts }),
  setModalState: (state) => set({ modalState: state }),
  setModalLoading: (loading) => set({ modalLoading: loading }),
  setUndoStack: (updater) => set((s) => ({ undoStack: typeof updater === "function" ? updater(s.undoStack) : updater })),
  setRedoStack: (updater) => set((s) => ({ redoStack: typeof updater === "function" ? updater(s.redoStack) : updater })),
  setIsInitialized: (isInitialized) => set({ isInitialized }),
  
  loadLayout: (resources, connectionLines, id, name) => set({
    resources, connectionLines, currentLayoutId: id, currentLayoutName: name,
    currentLayoutSaved: true, selectedResourceId: null, selectedResourceForConfigId: null,
  }),
  clearCanvas: () => set({
    resources: [], connectionLines: [], currentLayoutId: null, currentLayoutName: null,
    currentLayoutSaved: true, selectedResourceId: null, selectedResourceForConfigId: null,
    activeDeploymentId: null, isDeploying: false, activeDrag: null, undoStack: [], redoStack: [],
  }),
}));