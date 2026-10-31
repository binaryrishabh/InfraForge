import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { addResource, connectResources } from "../src/features/canvas/actions";
import { requestRun } from "../src/features/canvas/designActions";
import { ChecksPanel } from "../src/features/canvas/components/designer/ChecksPanel";
import { StatusBar } from "../src/features/canvas/components/designer/StatusBar";
import type { ReactNode } from "react";

function render(node: ReactNode) {
  const initial = useCanvasStore.getInitialState(), previous = { ...initial };
  Object.assign(initial, useCanvasStore.getState());
  try { return renderToStaticMarkup(node); }
  finally { Object.assign(initial, previous); }
}

afterEach(() => useCanvasStore.getState().clearCanvas());

test("canvas can draw supported CDN, registry and direct DNS entry shapes", () => {
  for (const [source, target] of [["CDN", "Object Storage"], ["Container Registry", "Object Storage"], ["DNS", "Virtual Machine"]] as const) {
    useCanvasStore.getState().clearCanvas();
    const s = addResource(source, { x: 0, y: 0 })!, t = addResource(target, { x: 480, y: 0 })!;
    expect(connectResources(s.id, t.id)).toBe(true);
    expect(render(<ChecksPanel />)).toContain("Ready for validation");
  }
});

test("local checks and status never promise execution for a structurally connected old CDN design", () => {
  useCanvasStore.setState({ resources: [
    { id: "cdn", type: "CDN", x: 0, y: 0 }, { id: "lb", type: "Load Balancer", x: 0, y: 0 }, { id: "app", type: "Virtual Machine", x: 0, y: 0 },
  ], connectionLines: [
    { id: "origin", sourceId: "cdn", targetId: "lb", sourceType: "CDN", targetType: "Load Balancer", port: 80 },
    { id: "backend", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
  ] });
  const checks = render(<ChecksPanel />), status = render(<StatusBar onChecks={() => {}} />);
  expect(checks).toContain("Ready for validation");
  expect(checks).toContain("Validate checks whether Model 2 can execute the saved design");
  expect(checks).not.toContain("Ready to run");
  expect(status).not.toContain("Ready to run");
  requestRun();
  expect(useCanvasStore.getState().modalState?.type).toBe("confirm-deploy");
});

test("a single app server can proceed to backend validation", () => {
  addResource("Virtual Machine", { x: 0, y: 0 });
  expect(render(<ChecksPanel />)).toContain("Ready for validation");
  requestRun();
  expect(useCanvasStore.getState().modalState?.type).toBe("confirm-deploy");
});
