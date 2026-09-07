import { create } from "zustand";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import type { Infrastructure } from "@shared/interface/Infrastructure.interface";
import type { ModalState } from "@shared/types/ModalState.types";
import type { UndoCanvasResourceAction } from "@shared/types/UndoCanvasResourceAction.types";

type Updater<T> = T | ((prev: T) => T);

export type CanvasUndoAction =
  | UndoCanvasResourceAction
  | { type: "delete-connection"; connectionLine: ConnectionLine; savedState: boolean };

export interface PendingConnection {
  sourceId: string;
  sourceType: ResourceType;
  cursorX: number;
  cursorY: number;
}

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
  selectedConnectionId: string | null;
  pendingConnection: PendingConnection | null;
  // Deployment
  activeDeploymentId: string | null;
  isDeploying: boolean;
  // True while a deployment is LIVE; cards switch from design to live mode.
  liveMode: boolean;
  // Empty state
  emptyCanvasStateDismissed: boolean;
  // Drag
  activeDrag: { label: ResourceType } | null;
  // Viewport (zoom & pan)
  scale: number;
  translateX: number;
  translateY: number;
  // Dropdown
  showLayoutDropdown: boolean;
  savedLayouts: Infrastructure[];
  // Modals
  modalState: ModalState;
  modalLoading: boolean;
  // Undo/Redo
  undoStack: CanvasUndoAction[];
  redoStack: CanvasUndoAction[];
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
  setSelectedConnectionId: (id: string | null) => void;
  startPendingConnection: (sourceId: string, sourceType: ResourceType, cursorX: number, cursorY: number) => void;
  movePendingConnection: (cursorX: number, cursorY: number) => void;
  cancelPendingConnection: () => void;
  setActiveDeploymentId: (id: string | null) => void;
  setIsDeploying: (deploying: boolean) => void;
  setLiveMode: (live: boolean) => void;
  setEmptyCanvasStateDismissed: (dismissed: boolean) => void;
  setActiveDrag: (drag: { label: ResourceType } | null) => void;
  setViewport: (scale: number, tx: number, ty: number) => void;
  setShowLayoutDropdown: (show: boolean) => void;
  setSavedLayouts: (layouts: Infrastructure[]) => void;
  setModalState: (state: ModalState) => void;
  setModalLoading: (loading: boolean) => void;
  setUndoStack: (updater: Updater<CanvasUndoAction[]>) => void;
  setRedoStack: (updater: Updater<CanvasUndoAction[]>) => void;
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
  selectedConnectionId: null,
  pendingConnection: null,
  activeDeploymentId: null,
  isDeploying: false,
  liveMode: false,
  emptyCanvasStateDismissed: false,
  activeDrag: null,
  scale: 1,
  translateX: 0,
  translateY: 0,
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
  setSelectedConnectionId: (id) => set({ selectedConnectionId: id }),
  startPendingConnection: (sourceId, sourceType, cursorX, cursorY) => set({ pendingConnection: { sourceId, sourceType, cursorX, cursorY } }),
  movePendingConnection: (cursorX, cursorY) => set((s) => s.pendingConnection ? ({ pendingConnection: { ...s.pendingConnection, cursorX, cursorY } }) : {}),
  cancelPendingConnection: () => set({ pendingConnection: null }),
  setActiveDeploymentId: (id) => set({ activeDeploymentId: id }),
  setIsDeploying: (deploying) => set({ isDeploying: deploying }),
  setLiveMode: (live) => set({ liveMode: live }),
  setEmptyCanvasStateDismissed: (dismissed) => set({ emptyCanvasStateDismissed: dismissed }),
  setActiveDrag: (drag) => set({ activeDrag: drag }),
  setViewport: (scale, tx, ty) => set({ scale, translateX: tx, translateY: ty }),
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
    selectedConnectionId: null, pendingConnection: null,
    scale: 1, translateX: 0, translateY: 0,
    activeDeploymentId: null, isDeploying: false, liveMode: false, activeDrag: null, undoStack: [], redoStack: [],
  }),
}));