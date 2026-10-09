import { afterEach, expect, test } from "bun:test";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import type { RunTopology } from "@infraforge/contracts/run-inputs";

const topology = (id: string): RunTopology => ({ resources: [{ id, type: "Virtual Machine", x: 0, y: 0 }], connectionLines: [] });
afterEach(() => useCanvasStore.getState().clearCanvas());

test("reattachment installs the live topology and revision without an edit", () => {
  const store = useCanvasStore.getState();
  store.loadLayout(topology("saved").resources, [], "design", "Design");
  store.loadRunTopology("run", topology("live"), 4, "design", "Design");
  expect(useCanvasStore.getState().resources[0]?.id).toBe("live");
  expect(useCanvasStore.getState().topologyRevision).toBe(4);
  expect(useCanvasStore.getState().liveTopologyDirty).toBe(false);
  store.applyLiveTopology("run", topology("stale"), 3);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("live");
});

test("new server revisions refresh a clean canvas without being sent as edits", () => {
  const store = useCanvasStore.getState();
  store.loadRunTopology("run", topology("original"), 0, "design", "Design");
  store.applyLiveTopology("run", topology("new"), 2);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("new");
  expect(useCanvasStore.getState().liveTopologyDirty).toBe(false);
});

test("server snapshots preserve unsent edits so CAS can reject stale editors", () => {
  const store = useCanvasStore.getState();
  store.loadRunTopology("run", topology("original"), 0, "design", "Design");
  store.setResources(topology("unsent").resources);
  store.applyLiveTopology("run", topology("other-editor"), 1);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("unsent");
  expect(useCanvasStore.getState().topologyRevision).toBe(0);
  expect(useCanvasStore.getState().liveTopologyDirty).toBe(true);
});

test("acknowledging one edit preserves a later edit and cannot alter another run", () => {
  const store = useCanvasStore.getState();
  store.loadRunTopology("run", topology("original"), 0, "design", "Design");
  const sent = topology("sent");
  store.setResources(sent.resources);
  store.setConnectionLines(sent.connectionLines);
  store.setResources(topology("later").resources);
  store.acknowledgeLiveTopology("run", sent, 1);
  expect(useCanvasStore.getState().topologyRevision).toBe(1);
  expect(useCanvasStore.getState().liveTopologyDirty).toBe(true);
  store.loadRunTopology("other-run", topology("other"), 0, "design", "Design");
  store.acknowledgeLiveTopology("run", sent, 2);
  expect(useCanvasStore.getState().topologyRevision).toBe(0);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("other");
  store.loadRunTopology("run", topology("reattached"), 4, "design", "Design");
  store.acknowledgeLiveTopology("run", sent, 1);
  expect(useCanvasStore.getState().topologyRevision).toBe(4);
  expect(useCanvasStore.getState().resources[0]?.id).toBe("reattached");
});
