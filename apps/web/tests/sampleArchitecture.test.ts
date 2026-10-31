import { afterEach, expect, test } from "bun:test";
import { SAMPLE_ARCHITECTURE } from "@infraforge/domain/examples";
import { loadSampleArchitecture } from "../src/features/canvas/designActions";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";

afterEach(() => useCanvasStore.getState().clearCanvas());

test("the sample action replaces the canvas with exactly the shared sample", () => {
  useCanvasStore.setState({ resources: [{ id: "old", type: "Object Storage", x: 0, y: 0 }],
    currentLayoutSaved: true, isInitialized: false });
  loadSampleArchitecture();
  const state = useCanvasStore.getState();
  expect(state.resources).toEqual(SAMPLE_ARCHITECTURE.resources);
  expect(state.connectionLines).toEqual(SAMPLE_ARCHITECTURE.connectionLines);
  expect(state.currentLayoutSaved).toBe(false);
  expect(state.isInitialized).toBe(true);
});
