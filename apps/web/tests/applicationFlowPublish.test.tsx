import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RESOURCE_PORTS, DEFAULT_ASYNC_QUEUE_SETTINGS, DEFAULT_ASYNC_WORKER_SETTINGS, type Resource } from "@infraforge/domain/resource";
import { resolveWorkload } from "@infraforge/domain/workload";
import { FlowSection } from "../src/features/canvas/components/inspector/FlowSection";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { createRunHost } from "../src/features/model2Run/worker/host";
import type { FromWorker } from "../src/features/model2Run/protocol";
import { ApplicationFlowLog } from "../src/features/live/ApplicationFlowLog";
import { StartingInputs } from "../src/features/reports/components/StartingInputs";
import type { StartingComparison } from "@infraforge/contracts/reports";

afterEach(() => useCanvasStore.getState().clearCanvas());
function canvas() {
  const types: Record<string, Resource["type"]> = { app: "Virtual Machine", queue: "Message Queue", worker: "Virtual Machine", store: "Object Storage" };
  const resources: Resource[] = Object.entries(types).map(([id, type]) => ({ id, type, x: 0, y: 0 }));
  resources[0]!.applicationFlow = { schema: "application-flow/3", operations: { write: { steps: [{ id: "send", kind: "publish", edge: "e0" }] } } };
  resources[1]!.asyncQueue = { ...DEFAULT_ASYNC_QUEUE_SETTINGS }; resources[2]!.asyncWorker = { ...DEFAULT_ASYNC_WORKER_SETTINGS };
  const connectionLines = [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]].map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: types[s!]!, targetType: types[t!]!, port: RESOURCE_PORTS[types[t!]!] }));
  return { resources, connectionLines };
}
test("publish inspector selects the attached queue, reports a missing edge, and supports undo/redo and run lock", () => {
  const d = canvas(), resource = d.resources[0]!;
  useCanvasStore.setState({ ...d, undoStack: [], redoStack: [], liveLocked: false, isDeploying: false });
  const initial = useCanvasStore.getInitialState(), previous = { ...initial }; Object.assign(initial, useCanvasStore.getState());
  try {
    const html = renderToStaticMarkup(<FlowSection resource={resource} disabled />);
    for (const text of ["Publish edge send", "queue (e0)", "wait for broker confirmation", "Physical durability Unknown", "Worker completion is separate", "disabled"]) expect(html).toContain(text);
    const missing = structuredClone(resource); missing.applicationFlow!.operations.write!.steps = [{ id: "send", kind: "publish", edge: "missing" }];
    expect(renderToStaticMarkup(<FlowSection resource={missing} disabled />)).toContain("Missing publish edge: missing");
  } finally { Object.assign(initial, previous); }
  const edited = structuredClone(resource.applicationFlow!); edited.operations.write!.steps.unshift({ id: "cpu", kind: "compute" });
  updateResource("app", { applicationFlow: edited }); undo(); expect(useCanvasStore.getState().resources[0]!.applicationFlow).toEqual(resource.applicationFlow);
  redo(); expect(useCanvasStore.getState().resources[0]!.applicationFlow).toEqual(edited);
  useCanvasStore.setState({ liveLocked: true }); updateResource("app", { applicationFlow: undefined }); expect(useCanvasStore.getState().resources[0]!.applicationFlow).toEqual(edited);
  useCanvasStore.setState({ liveLocked: false });
});

test("browser worker and live flow log carry /3 publish confirmation and queue binding", () => {
  const d = canvas(), messages: FromWorker[] = [], queue: Array<() => void> = [];
  const host = createRunHost(m => messages.push(structuredClone(m)), { set: run => { queue.push(run); return run; }, clear: () => { queue.length = 0; } });
  host.handle({ type: "start", start: { input: { ...d, workloadProfile: resolveWorkload({ targetThroughput: 60, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0, payloadSize: "light" }), seed: "publish-worker", adapterProfiles: ["failure-cause/1", "application-flow/3"] }, horizonSeconds: 2, stopAtSecond: 2, speed: 1 } });
  while (queue.length) queue.shift()!();
  expect(messages.filter(m => m.type === "error")).toEqual([]);
  const seconds = messages.filter(m => m.type === "second"); expect(seconds).toHaveLength(2);
  const e = seconds.at(-1)!.applicationFlow!; expect(e.profile).toBe("application-flow/3");
  expect(e.events.find(e => e.kind === "flow-branch-terminal")!.detail).toMatchObject({ edge: "e0", stage: "publish", confirmation: "confirmed", ambiguous: false, physicalDurability: "Unknown" });
  const html = renderToStaticMarkup(<ApplicationFlowLog evidence={e} />); expect(html).toContain("confirmation: confirmed"); expect(html).toContain("edge: e0"); expect(html).toContain("physicalDurability: Unknown");
});

test("profile mismatch explains descriptive comparison", () => {
  const starting: StartingComparison = { grade: "side-by-side-only", facets: { inputVersion: "same", model: "same", catalog: "same", workload: "same", seed: "same", topology: "same", resourceOrder: "same", adapterProfiles: "different" }, compatibilityReason: "Captured adapter profile selections differ; these runs use different replay semantics and permit descriptive comparison only.", design: null, workload: [], alignment: { code: "unknown", aligned: [], shifted: [], scope: "Captured resources" } };
  const html = renderToStaticMarkup(<StartingInputs starting={starting} />); expect(html).toContain("Captured replay profiles"); expect(html).toContain(starting.compatibilityReason!);
});
