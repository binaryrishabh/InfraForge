import { toast } from "sonner";
import { validateConnection } from "@infraforge/domain/validation";
import { RESOURCE_PORTS, type Resource, type ResourceType } from "@infraforge/domain/resource";
import { useCanvasStore } from "./store/canvasStore";
import { positionIsOccupied } from "./utils/cardFootprint";
import { NODE_CARD_WIDTH, DESIGN_CARD_HEIGHT, GRID_SIZE } from "./utils/nodeGeometry";
import { undo } from "./history";

type Store = ReturnType<typeof useCanvasStore.getState>;

/* Canvas cards plus engine-owned replicas form the obstacle set: a node can
never be placed on top of an autoscaled replica, and vice versa. */
function obstacles(store: Store) {
  return [
    ...store.resources.map((r) => ({ id: r.id, x: r.x, y: r.y })),
    ...Object.entries(store.replicaPositions).map(([id, pos]) => ({ id, x: pos.x, y: pos.y })),
  ];
}
function editable(store: Store, quiet = false) {
  if (store.liveLocked) { if (!quiet) toast.warning("This challenge attempt runs under fixed conditions. The design cannot change until it ends."); return false; }
  if (store.isDeploying) { if (!quiet) toast.warning("Editing is paused while the run starts."); return false; }
  return true;
}
const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

const PREFIX: Record<ResourceType, string> = {
  DNS: "dns", CDN: "cdn", Firewall: "fw", "Load Balancer": "lb", "Virtual Machine": "vm", "Container Registry": "registry",
  Cache: "cache", Database: "db", "Object Storage": "storage", "Message Queue": "queue", "Monitoring Agent": "monitor",
};
// Short readable ids (vm-1, db-2) that never reuse an id still reachable through undo or redo.
function nextId(store: Store, type: ResourceType) {
  const taken = new Set(store.resources.map((r) => r.id));
  for (const entry of [...store.undoStack, ...store.redoStack]) if (entry.type === "add" || entry.type === "delete") taken.add(entry.resource.id);
  let n = 1;
  while (taken.has(`${PREFIX[type]}-${n}`)) n++;
  return `${PREFIX[type]}-${n}`;
}

export function addResource(type: ResourceType, at?: { x: number; y: number }) {
  const store = useCanvasStore.getState();
  if (!editable(store)) return null;
  let x: number, y: number;
  if (at) { x = snap(at.x); y = snap(at.y); }
  else {
    // Keyboard and click adds land at the centre of the visible canvas, then search outward for a free slot.
    const rect = document.getElementById("canvas")?.getBoundingClientRect();
    const cx = rect ? (rect.width / 2 - store.translateX) / store.scale : 240;
    const cy = rect ? (rect.height / 2 - store.translateY) / store.scale : 160;
    x = snap(cx - NODE_CARD_WIDTH / 2); y = snap(cy - DESIGN_CARD_HEIGHT / 2);
    const taken = obstacles(store);
    for (let ring = 0; ring < 12 && positionIsOccupied(taken, x, y); ring++) {
      const offsets = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
      const free = offsets.map(([dx, dy]) => [x + dx * (NODE_CARD_WIDTH + 24) * (ring + 1), y + dy * (DESIGN_CARD_HEIGHT + 48) * (ring + 1)] as const)
        .find(([nx, ny]) => !positionIsOccupied(taken, snap(nx), snap(ny)));
      if (free) { x = snap(free[0]); y = snap(free[1]); break; }
    }
  }
  if (positionIsOccupied(obstacles(store), x, y)) { toast.warning("That space is already occupied."); return null; }
  const resource: Resource = { id: nextId(store, type), type, x, y };
  store.setResources((prev) => [...prev, resource]);
  store.setUndoStack((prev) => [...prev, { type: "add", resource, connectionLines: [], savedState: store.currentLayoutSaved }]);
  store.setRedoStack([]);
  store.setCurrentLayoutSaved(false);
  store.setIsInitialized(true);
  return resource;
}

// Shared by pointer drag-to-connect and the inspector's "Connect to" control.
export function connectResources(sourceId: string, targetId: string) {
  const store = useCanvasStore.getState();
  if (!editable(store)) return false;
  const source = store.resources.find((r) => r.id === sourceId), target = store.resources.find((r) => r.id === targetId);
  if (!source || !target || sourceId === targetId) return false;
  if (store.connectionLines.some((l) => l.sourceId === sourceId && l.targetId === targetId)) { toast.warning("These resources are already connected."); return false; }
  const verdict = validateConnection(source.type, target.type);
  if (!verdict.valid) { toast.warning(verdict.message); return false; }
  const connectionLine = { id: `connection-${Date.now().toString(36)}`, sourceId, targetId, sourceType: source.type, targetType: target.type, port: RESOURCE_PORTS[target.type] || 80 };
  store.setConnectionLines((prev) => [...prev, connectionLine]);
  store.setUndoStack((prev) => [...prev, { type: "add-connection", connectionLine, savedState: store.currentLayoutSaved }]);
  store.setRedoStack([]);
  store.setCurrentLayoutSaved(false);
  return true;
}

export function deleteResource(resourceId: string) {
  const store = useCanvasStore.getState();
  if (!editable(store)) return;
  const resource = store.resources.find((r) => r.id === resourceId);
  if (!resource) return;
  const touching = store.connectionLines.filter((line) => line.sourceId === resourceId || line.targetId === resourceId);
  store.setUndoStack((prev) => [...prev, { type: "delete", resource, connectionLines: touching, savedState: store.currentLayoutSaved }]);
  store.setRedoStack([]);
  store.setResources((prev) => prev.filter((r) => r.id !== resourceId));
  store.setConnectionLines((prev) => prev.filter((line) => line.sourceId !== resourceId && line.targetId !== resourceId));
  if (store.selectedResourceId === resourceId) store.setSelectedResourceId(null);
  if (store.selectedResourceForConfigId === resourceId) store.setSelectedResourceForConfigId(null);
  store.setCurrentLayoutSaved(false);
  toast(`Removed ${resource.name || resource.id}`, { action: { label: "Undo", onClick: undo }, duration: 5000 });
}

export function deleteConnection(connectionId: string) {
  const store = useCanvasStore.getState();
  if (!editable(store)) return;
  const line = store.connectionLines.find((l) => l.id === connectionId);
  if (!line) return;
  store.setUndoStack((prev) => [...prev, { type: "delete-connection", connectionLine: line, savedState: store.currentLayoutSaved }]);
  store.setRedoStack([]);
  store.setConnectionLines((prev) => prev.filter((l) => l.id !== connectionId));
  store.setSelectedConnectionId(null);
  store.setCurrentLayoutSaved(false);
  toast("Connection removed", { action: { label: "Undo", onClick: undo }, duration: 5000 });
}

const TRACKED = ["name", "skuId", "autoscaling", "asyncQueue", "asyncWorker", "applicationFlow", "retry", "circuitBreaker", "public", "encryption", "openPorts"] as const;
export function updateResource(resourceId: string, patch: Partial<Resource>) {
  const store = useCanvasStore.getState();
  if (!editable(store)) return;
  const resource = store.resources.find((r) => r.id === resourceId);
  if (!resource) return;
  const before: Partial<Resource> = {}, after: Partial<Resource> = {};
  for (const key of TRACKED) if (key in patch) { Object.assign(before, { [key]: resource[key] }); Object.assign(after, { [key]: patch[key] }); }
  const last = store.undoStack[store.undoStack.length - 1];
  const keys = Object.keys(after).sort().join(",");
  // Typing in one field coalesces into a single undo step.
  if (last?.type === "config" && last.resourceId === resourceId && Object.keys(last.after).sort().join(",") === keys) {
    store.setUndoStack((prev) => prev.map((entry, index) => index === prev.length - 1 && entry.type === "config" ? { ...entry, after } : entry));
  } else {
    store.setUndoStack((prev) => [...prev, { type: "config", resourceId, before, after, savedState: store.currentLayoutSaved }]);
    store.setRedoStack([]);
  }
  store.setResources((prev) => prev.map((r) => (r.id === resourceId ? { ...r, ...patch } : r)));
  store.setCurrentLayoutSaved(false);
}

// Live pointer feedback; history is recorded once by commitMove.
export function moveResource(resourceId: string, x: number, y: number) {
  const store = useCanvasStore.getState();
  if (!editable(store, true)) return;
  store.setResources((prev) => prev.map((r) => (r.id === resourceId ? { ...r, x, y } : r)));
}

export function commitMove(resourceId: string, fromX: number, fromY: number, toX: number, toY: number) {
  const store = useCanvasStore.getState();
  if (!editable(store, true) || (fromX === toX && fromY === toY)) return false;
  if (positionIsOccupied(obstacles(store), toX, toY, resourceId)) {
    store.setResources((prev) => prev.map((r) => (r.id === resourceId ? { ...r, x: fromX, y: fromY } : r)));
    toast.warning("That space is already occupied.");
    return false;
  }
  store.setUndoStack((prev) => [...prev, { type: "move", resourceId, fromX, fromY, toX, toY, savedState: store.currentLayoutSaved }]);
  store.setRedoStack([]);
  store.setCurrentLayoutSaved(false);
  return true;
}

// Keyboard nudge: one grid step, or four with Shift.
export function nudgeResource(resourceId: string, dx: number, dy: number) {
  const store = useCanvasStore.getState();
  const resource = store.resources.find((r) => r.id === resourceId);
  if (!resource || !editable(store)) return;
  const toX = resource.x + dx * GRID_SIZE, toY = resource.y + dy * GRID_SIZE;
  moveResource(resourceId, toX, toY);
  commitMove(resourceId, resource.x, resource.y, toX, toY);
}

export function selectResource(resourceId: string | null) {
  const store = useCanvasStore.getState();
  store.setSelectedResourceId(resourceId);
  store.setSelectedResourceForConfigId(resourceId);
  if (resourceId) store.setSelectedConnectionId(null);
}
