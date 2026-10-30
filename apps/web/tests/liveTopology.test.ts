import { afterEach, expect, test } from "bun:test";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import * as deploymentApi from "../src/api/deployment.api";

const topology = (id: string): RunTopology => ({ resources: [{ id, type: "Virtual Machine", x: 0, y: 0 }], connectionLines: [] });
afterEach(() => useCanvasStore.getState().clearCanvas());

test("reattachment installs the live topology and revision without an edit", () => {
  const store = useCanvasStore.getState();
  store.loadLayout(topology("saved").resources, [], "design", "Design");
  store.loadRunTopology("run", topology("live"), 4, "design", "Design");
  expect(useCanvasStore.getState().resources[0]?.id).toBe("live");
  expect(useCanvasStore.getState().topologyRevision).toBe(4);
  expect(useCanvasStore.getState()).not.toHaveProperty("liveTopologyDirty");
  store.applyLiveTopology("run", topology("stale"), 3);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("live");
});

test("new server revisions refresh a clean canvas without being sent as edits", () => {
  const store = useCanvasStore.getState();
  store.loadRunTopology("run", topology("original"), 0, "design", "Design");
  store.applyLiveTopology("run", topology("new"), 2);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("new");
});

test("newer recorded topology remains authoritative over unsupported local edits", () => {
  const store = useCanvasStore.getState();
  store.loadRunTopology("run", topology("original"), 0, "design", "Design");
  store.setResources(topology("unsent").resources);
  store.applyLiveTopology("run", topology("other-editor"), 1);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("other-editor");
  expect(useCanvasStore.getState().topologyRevision).toBe(1);
});

test("topology updates cannot alter another run or replace a newer revision", () => {
  const store = useCanvasStore.getState();
  store.loadRunTopology("other-run", topology("other"), 0, "design", "Design");
  store.applyLiveTopology("run", topology("wrong-run"), 2);
  expect(useCanvasStore.getState().topologyRevision).toBe(0);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("other");
  store.loadRunTopology("run", topology("reattached"), 4, "design", "Design");
  store.applyLiveTopology("run", topology("old-revision"), 1);
  expect(useCanvasStore.getState().topologyRevision).toBe(4);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("reattached");
});

test("web API and canvas state no longer advertise unsupported live edit operations", () => {
  expect("syncDeploymentTopology" in deploymentApi).toBe(false);
  expect("scaleVertical" in deploymentApi).toBe(false);
  expect(useCanvasStore.getState()).not.toHaveProperty("acknowledgeLiveTopology");
});
