import { create } from "zustand";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";

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

  // Layout actions (Dispatch-compatible signatures so existing hooks keep working)
  setResources: (updater: Updater<Resource[]>) => void;
  setConnectionLines: (updater: Updater<ConnectionLine[]>) => void;
  // Metadata actions
  setCurrentLayoutId: (id: string | null) => void;
  setCurrentLayoutName: (name: string | null) => void;
  setCurrentLayoutSaved: (saved: boolean) => void;
  // Interaction actions
  setSelectedResourceId: (id: string | null) => void;
  setSelectedResourceForConfigId: (id: string | null) => void;
  setIsConnecting: (connecting: boolean) => void;
  // Deployment actions
  setActiveDeploymentId: (id: string | null) => void;
  setIsDeploying: (deploying: boolean) => void;
  // Empty state
  setEmptyCanvasStateDismissed: (dismissed: boolean) => void;
  // Composite actions
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

  setResources: (updater) =>
    set((s) => ({ resources: typeof updater === "function" ? updater(s.resources) : updater })),
  setConnectionLines: (updater) =>
    set((s) => ({ connectionLines: typeof updater === "function" ? updater(s.connectionLines) : updater })),

  setCurrentLayoutId: (id) => set({ currentLayoutId: id }),
  setCurrentLayoutName: (name) => set({ currentLayoutName: name }),
  setCurrentLayoutSaved: (saved) => set({ currentLayoutSaved: saved }),
  setSelectedResourceId: (id) => set({ selectedResourceId: id }),
  setSelectedResourceForConfigId: (id) => set({ selectedResourceForConfigId: id }),
  setIsConnecting: (connecting) => set({ isConnecting: connecting }),
  setActiveDeploymentId: (id) => set({ activeDeploymentId: id }),
  setIsDeploying: (deploying) => set({ isDeploying: deploying }),
  setEmptyCanvasStateDismissed: (dismissed) => set({ emptyCanvasStateDismissed: dismissed }),

  loadLayout: (resources, connectionLines, id, name) =>
    set({
      resources,
      connectionLines,
      currentLayoutId: id,
      currentLayoutName: name,
      currentLayoutSaved: true,
      selectedResourceId: null,
      selectedResourceForConfigId: null,
    }),

  clearCanvas: () =>
    set({
      resources: [],
      connectionLines: [],
      currentLayoutId: null,
      currentLayoutName: null,
      currentLayoutSaved: true,
      selectedResourceId: null,
      selectedResourceForConfigId: null,
      activeDeploymentId: null,
      isDeploying: false,
    }),
}));