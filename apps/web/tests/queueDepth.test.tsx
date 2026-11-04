import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_ASYNC_WORKER_SETTINGS, type Resource } from "@infraforge/domain/resource";
import { AsyncSection } from "../src/features/canvas/components/inspector/AsyncSection";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";

const worker = (): Resource => ({ id: "worker", type: "Virtual Machine", x: 0, y: 0, asyncWorker: { ...DEFAULT_ASYNC_WORKER_SETTINGS } });
test("worker exposes a single bounded delay input with blank default, lease consequence and run lock", () => {
  const r = worker(), html = renderToStaticMarkup(<AsyncSection resource={r} disabled />);
  for (const text of ["Delay before acknowledgement (milliseconds)", 'min="0" max="60000" step="1" disabled', "Default (0 ms)", "The delay starts after the result write", "Lease expiry wins over acknowledgement at the same simulated instant."]) expect(html).toContain(text);
  expect(html.split("Delay before acknowledgement (milliseconds)")).toHaveLength(2);
  r.asyncWorker!.acknowledgementDelayMs = 2000;
  expect(renderToStaticMarkup(<AsyncSection resource={r} disabled={false} />)).toContain('value="2000"');
  r.asyncWorker!.enabled = false;
  expect(renderToStaticMarkup(<AsyncSection resource={r} disabled={false} />)).not.toContain("Delay before acknowledgement");
});

test("delay supports undo, redo, save/reload, blank reset and run/deploy locks", () => {
  try {
    useCanvasStore.getState().clearCanvas();
    const r = worker(); useCanvasStore.setState({ resources: [r], liveLocked: false, isDeploying: false });
    updateResource(r.id, { asyncWorker: { ...r.asyncWorker!, acknowledgementDelayMs: 2000 } });
    expect(useCanvasStore.getState().resources[0]!.asyncWorker!.acknowledgementDelayMs).toBe(2000);
    undo(); expect(useCanvasStore.getState().resources[0]!.asyncWorker).not.toHaveProperty("acknowledgementDelayMs");
    redo(); expect(useCanvasStore.getState().resources[0]!.asyncWorker!.acknowledgementDelayMs).toBe(2000);
    for (const locks of [{ liveLocked: true, isDeploying: false }, { liveLocked: false, isDeploying: true }]) {
      useCanvasStore.setState(locks); updateResource(r.id, { asyncWorker: { ...r.asyncWorker!, acknowledgementDelayMs: 3000 } });
      expect(useCanvasStore.getState().resources[0]!.asyncWorker!.acknowledgementDelayMs).toBe(2000);
    }
    useCanvasStore.setState({ resources: JSON.parse(JSON.stringify(useCanvasStore.getState().resources)), liveLocked: false, isDeploying: false });
    expect(useCanvasStore.getState().resources[0]!.asyncWorker!.acknowledgementDelayMs).toBe(2000);
    updateResource(r.id, { asyncWorker: { ...r.asyncWorker!, acknowledgementDelayMs: undefined } });
    expect(JSON.parse(JSON.stringify(useCanvasStore.getState().resources[0]!)).asyncWorker).not.toHaveProperty("acknowledgementDelayMs");
  } finally { useCanvasStore.getState().clearCanvas(); useCanvasStore.setState({ liveLocked: false, isDeploying: false }); }
});
