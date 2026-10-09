import { create } from "zustand";
import type { Resource } from "@infraforge/domain/resource";
import type { ConnectionLine } from "@infraforge/domain/resource";
import type { ResourceType } from "@infraforge/domain/resource";
import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import type { ModalState } from "../types/ModalState.types";
import type { UndoCanvasResourceAction } from "../types/UndoCanvasResourceAction.types";
import type { RunTopology } from "@infraforge/contracts/run-inputs";

type Updater<T> = T | ((prev: T) => T);

export type CanvasUndoAction =
  | UndoCanvasResourceAction
  | { type: "delete-connection"; connectionLine: ConnectionLine; savedState: boolean };

export interface PendingConnection {
  sourceId: string;
  sourceType: ResourceType;
  // Canvas-space port the drag started from — the line's fixed origin edge.
  anchorX: number;
  anchorY: number;
  cursorX: number;
  cursorY: number;
}

/* Where inside the palette row the pointer grabbed. The DragOverlay origin
trails the cursor by exactly this offset, so the ghost re-adds it to stay
centered on the cursor. */
export interface ActiveDragState {
  label: ResourceType;
  grabOffsetX: number;
  grabOffsetY: number;
}

interface CanvasStoreState {
  resources: Resource[];
  connectionLines: ConnectionLine[];
  currentLayoutId: string | null;
  currentLayoutName: string | null;
  currentLayoutSaved: boolean;
  selectedResourceId: string | null;
  selectedResourceForConfigId: string | null;
  selectedConnectionId: string | null;
  pendingConnection: PendingConnection | null;
  activeDeploymentId: string | null;
  topologyRevision: number | null;
  liveTopologyDirty: boolean;
  isDeploying: boolean;
  liveMode: boolean;
  emptyCanvasStateDismissed: boolean;
  activeDrag: ActiveDragState | null;
  // Canvas positions of engine-owned ASG replicas. Assigned once when a
  // replica first appears, then frozen: dragging a base VM never drags its
  // replicas along, and replicas occupy space like real nodes.
  replicaPositions: Record<string, { x: number; y: number }>;
  // Measured rendered heights of card wrappers, fed by useCardHeight so
  // connection anchors sit exactly on the port dots at any card height.
  cardHeights: Record<string, number>;
  scale: number;
  translateX: number;
  translateY: number;
  showLayoutDropdown: boolean;
  savedLayouts: Infrastructure[];
  modalState: ModalState;
  modalLoading: boolean;
  undoStack: CanvasUndoAction[];
  redoStack: CanvasUndoAction[];
  isInitialized: boolean;
  setResources: (updater: Updater<Resource[]>) => void;
  setConnectionLines: (updater: Updater<ConnectionLine[]>) => void;
  setCurrentLayoutId: (id: string | null) => void;
  setCurrentLayoutName: (name: string | null) => void;
  setCurrentLayoutSaved: (saved: boolean) => void;
  setSelectedResourceId: (id: string | null) => void;
  setSelectedResourceForConfigId: (id: string | null) => void;
  setSelectedConnectionId: (id: string | null) => void;
  startPendingConnection: (sourceId: string, sourceType: ResourceType, anchorX: number, anchorY: number) => void;
  movePendingConnection: (cursorX: number, cursorY: number) => void;
  cancelPendingConnection: () => void;
  setActiveDeploymentId: (id: string | null) => void;
  setIsDeploying: (deploying: boolean) => void;
  setLiveMode: (live: boolean) => void;
  setEmptyCanvasStateDismissed: (dismissed: boolean) => void;
  setActiveDrag: (drag: ActiveDragState | null) => void;
  setReplicaPosition: (id: string, x: number, y: number) => void;
  pruneReplicaPositions: (aliveIds: string[]) => void;
  clearReplicaPositions: () => void;
  setCardHeight: (id: string, height: number) => void;
  setViewport: (scale: number, tx: number, ty: number) => void;
  setShowLayoutDropdown: (show: boolean) => void;
  setSavedLayouts: (layouts: Infrastructure[]) => void;
  setModalState: (state: ModalState) => void;
  setModalLoading: (loading: boolean) => void;
  setUndoStack: (updater: Updater<CanvasUndoAction[]>) => void;
  setRedoStack: (updater: Updater<CanvasUndoAction[]>) => void;
  setIsInitialized: (initialized: boolean) => void;
  loadLayout: (resources: Resource[], connectionLines: ConnectionLine[], id: string | null, name: string | null) => void;
  loadRunTopology: (deploymentId: string, topology: RunTopology, revision: number, layoutId: string, name: string | null) => void;
  applyLiveTopology: (deploymentId: string, topology: RunTopology, revision: number) => void;
  acknowledgeLiveTopology: (deploymentId: string, topology: RunTopology, revision: number) => void;
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
  topologyRevision: null,
  liveTopologyDirty: false,
  isDeploying: false,
  liveMode: false,
  emptyCanvasStateDismissed: false,
  activeDrag: null,
  replicaPositions: {},
  cardHeights: {},
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
  setResources: (updater) => set((s) => ({ resources: typeof updater === "function" ? updater(s.resources) : updater,
    liveTopologyDirty: s.activeDeploymentId !== null })),
  setConnectionLines: (updater) => set((s) => ({ connectionLines: typeof updater === "function" ? updater(s.connectionLines) : updater,
    liveTopologyDirty: s.activeDeploymentId !== null })),
  setCurrentLayoutId: (id) => set({ currentLayoutId: id }),
  setCurrentLayoutName: (name) => set({ currentLayoutName: name }),
  setCurrentLayoutSaved: (saved) => set({ currentLayoutSaved: saved }),
  setSelectedResourceId: (id) => set({ selectedResourceId: id }),
  setSelectedResourceForConfigId: (id) => set({ selectedResourceForConfigId: id }),
  setSelectedConnectionId: (id) => set({ selectedConnectionId: id }),
  startPendingConnection: (sourceId, sourceType, anchorX, anchorY) =>
    set({
      pendingConnection: {
        sourceId,
        sourceType,
        anchorX,
        anchorY,
        cursorX: anchorX,
        cursorY: anchorY,
      },
    }),
  movePendingConnection: (cursorX, cursorY) => set((s) => s.pendingConnection ? ({ pendingConnection: { ...s.pendingConnection, cursorX, cursorY } }) : {}),
  cancelPendingConnection: () => set({ pendingConnection: null }),
  setActiveDeploymentId: (id) => set({ activeDeploymentId: id, topologyRevision: null, liveTopologyDirty: false }),
  setIsDeploying: (deploying) => set({ isDeploying: deploying }),
  setLiveMode: (live) => set({ liveMode: live }),
  setEmptyCanvasStateDismissed: (dismissed) => set({ emptyCanvasStateDismissed: dismissed }),
  setActiveDrag: (drag) => set({ activeDrag: drag }),
  setReplicaPosition: (id, x, y) =>
    set((s) => ({ replicaPositions: { ...s.replicaPositions, [id]: { x, y } } })),
  pruneReplicaPositions: (aliveIds) =>
    set((s) => {
      const alive = new Set(aliveIds);
      const next: Record<string, { x: number; y: number }> = {};
      for (const [id, pos] of Object.entries(s.replicaPositions)) {
        if (alive.has(id)) next[id] = pos;
      }
      return { replicaPositions: next };
    }),
  clearReplicaPositions: () => set({ replicaPositions: {} }),
  setCardHeight: (id, height) =>
    set((s) => ({ cardHeights: { ...s.cardHeights, [id]: height } })),
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
  loadRunTopology: (deploymentId, topology, revision, layoutId, name) => set({
    ...topology, activeDeploymentId: deploymentId, topologyRevision: revision, liveTopologyDirty: false,
    currentLayoutId: layoutId, currentLayoutName: name, currentLayoutSaved: false,
    selectedResourceId: null, selectedResourceForConfigId: null, selectedConnectionId: null,
    pendingConnection: null, undoStack: [], redoStack: [], replicaPositions: {}, cardHeights: {},
    isInitialized: true, isDeploying: false,
  }),
  applyLiveTopology: (deploymentId, topology, revision) => set((s) => {
    if (s.activeDeploymentId !== deploymentId || s.liveTopologyDirty || revision <= (s.topologyRevision ?? -1)) return {};
    return { ...topology, topologyRevision: revision, currentLayoutSaved: false };
  }),
  acknowledgeLiveTopology: (deploymentId, topology, revision) => set((s) => {
    if (s.activeDeploymentId !== deploymentId || revision <= (s.topologyRevision ?? -1)) return {};
    return { topologyRevision: revision, liveTopologyDirty: s.resources !== topology.resources || s.connectionLines !== topology.connectionLines };
  }),
  clearCanvas: () => set({
    resources: [], connectionLines: [], currentLayoutId: null, currentLayoutName: null,
    currentLayoutSaved: true, selectedResourceId: null, selectedResourceForConfigId: null,
    selectedConnectionId: null, pendingConnection: null,
    scale: 1, translateX: 0, translateY: 0,
    activeDeploymentId: null, isDeploying: false, liveMode: false, activeDrag: null,
    topologyRevision: null, liveTopologyDirty: false,
    replicaPositions: {}, cardHeights: {}, undoStack: [], redoStack: [],
  }),
}));
