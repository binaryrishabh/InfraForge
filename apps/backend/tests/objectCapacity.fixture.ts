import { RESOURCE_PORTS } from "@infraforge/domain/resource";
import { capacityLayout, capacityWorkload } from "./queueCapacity.fixture";

export const objectModes = ["upload", "idempotent", "cdn", "registry", "plain"] as const;
export function objectLayout(mode: typeof objectModes[number], capacityMiB?: number) {
  const layout = capacityLayout();
  if (mode === "idempotent") {
    Object.assign(layout.resources[1]!.asyncQueue!, { visibilityTimeoutSeconds: 1, capacityMessages: 3 });
    Object.assign(layout.resources[2]!.asyncWorker!, { idempotentResults: true, cpuMsPerJob: 1500 });
  }
  if (["cdn", "registry", "plain"].includes(mode)) {
    layout.resources = mode === "cdn" ? [{ id: "cdn", type: "CDN", x: 0, y: 0 }, layout.resources[3]!] : layout.resources.filter(r => ["app", "store"].includes(r.id));
    if (mode === "registry") layout.resources.push({ id: "registry", type: "Container Registry", x: 0, y: 0 });
    const links = mode === "cdn" ? [["cdn", "store"]] : mode === "registry" ? [["app", "registry"], ["registry", "store"]] : [["app", "store"]];
    const types = new Map(layout.resources.map(r => [r.id, r.type]));
    layout.connectionLines = links.map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: types.get(s!)!, targetType: types.get(t!)!, port: RESOURCE_PORTS[types.get(t!)!] }));
  }
  if (capacityMiB !== undefined) layout.resources.find(r => r.id === "store")!.objectStoragePolicy = { version: 1, capacityMiB };
  return layout;
}
export const objectWorkload = (mode: typeof objectModes[number]) => ({ ...capacityWorkload, targetThroughput: mode === "upload" ? 2400 : mode === "cdn" ? 120 : 480, readWriteRatio: mode === "cdn" ? 1 : 0.8 });
