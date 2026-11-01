import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import { design, prepare } from "./asyncCanvas.fixture";
import { cdnDesign } from "./cdnTtl.fixture";
import { createProductModel2 } from "../src/model2/product/run";

export const objectModes = ["upload", "idempotent", "cdn", "registry", "plain"] as const;
export function objectDesign(mode: typeof objectModes[number] = "upload") {
  if (mode === "cdn") return cdnDesign();
  const saved = design(true, 8);
  if (mode === "idempotent") {
    saved.resources.find(r => r.id === "worker")!.asyncWorker!.idempotentResults = true;
    saved.resources.find(r => r.id === "queue")!.asyncQueue!.visibilityTimeoutSeconds = 1;
    saved.resources.find(r => r.id === "worker")!.asyncWorker!.cpuMsPerJob = 1500;
  }
  if (mode === "registry" || mode === "plain") {
    saved.resources = saved.resources.filter(r => ["app", "store"].includes(r.id));
    if (mode === "registry") saved.resources.push({ id: "registry", type: "Container Registry", x: 0, y: 0 });
    const links = mode === "registry" ? [["app", "registry"], ["registry", "store"]] : [["app", "store"]];
    const types = new Map(saved.resources.map(r => [r.id, r.type]));
    saved.connections = links.map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: types.get(s!)!, targetType: types.get(t!)!, port: RESOURCE_PORTS[types.get(t!)!] }));
  }
  return saved;
}
export function objectSetup(mode: typeof objectModes[number] = "upload", capacityMiB?: number) {
  const saved = objectDesign(mode);
  if (capacityMiB !== undefined) Object.assign(saved.resources.find(r => r.type === "Object Storage")!, { objectStoragePolicy: { version: 1, capacityMiB } });
  const adapted = prepare(saved);
  return { saved, ...adapted, runtime: createProductModel2(adapted.compiled) };
}
