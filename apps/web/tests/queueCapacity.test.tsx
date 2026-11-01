import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_ASYNC_QUEUE_SETTINGS, type Resource } from "@infraforge/domain/resource";
import { AsyncSection } from "../src/features/canvas/components/inspector/AsyncSection";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";

const queue = (): Resource => ({ id: "queue", type: "Message Queue", x: 0, y: 0, asyncQueue: { ...DEFAULT_ASYNC_QUEUE_SETTINGS } });
test("enabled queue exposes one bounded capacity input, blank default, exact help and run lock", () => {
  const r = queue(), html = renderToStaticMarkup(<AsyncSection resource={r} disabled />);
  for (const text of ["Queue capacity (messages)", 'min="1" max="100000" step="1" disabled', "Default (1000 × modeled queue cores)", "Maximum live messages this modeled queue can own at once. When it is full, new publishes are refused.", "This is an educational message limit, not a cloud-provider storage guarantee."]) expect(html).toContain(text);
  r.asyncQueue!.enabled = false;
  expect(renderToStaticMarkup(<AsyncSection resource={r} disabled={false} />)).not.toContain("Queue capacity (messages)");
});

test("capacity supports undo/redo, blank reset and both deployment locks", () => {
  try {
    useCanvasStore.getState().clearCanvas();
    const r = queue(); useCanvasStore.setState({ resources: [r], liveLocked: false, isDeploying: false });
    updateResource(r.id, { asyncQueue: { ...r.asyncQueue!, capacityMessages: 3 } });
    expect(useCanvasStore.getState().resources[0]!.asyncQueue!.capacityMessages).toBe(3);
    undo(); expect(useCanvasStore.getState().resources[0]!.asyncQueue).not.toHaveProperty("capacityMessages");
    redo(); expect(useCanvasStore.getState().resources[0]!.asyncQueue!.capacityMessages).toBe(3);
    for (const locks of [{ liveLocked: true, isDeploying: false }, { liveLocked: false, isDeploying: true }]) {
      useCanvasStore.setState(locks); updateResource(r.id, { asyncQueue: { ...r.asyncQueue!, capacityMessages: 4 } });
      expect(useCanvasStore.getState().resources[0]!.asyncQueue!.capacityMessages).toBe(3);
    }
    useCanvasStore.setState({ liveLocked: false, isDeploying: false });
    updateResource(r.id, { asyncQueue: { ...r.asyncQueue!, capacityMessages: undefined } });
    expect(JSON.parse(JSON.stringify(useCanvasStore.getState().resources[0]!)).asyncQueue).not.toHaveProperty("capacityMessages");
  } finally { useCanvasStore.getState().clearCanvas(); useCanvasStore.setState({ liveLocked: false, isDeploying: false }); }
});
