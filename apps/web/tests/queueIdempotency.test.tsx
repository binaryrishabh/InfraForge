import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_ASYNC_WORKER_SETTINGS, DEFAULT_ASYNC_QUEUE_SETTINGS, type Resource } from "@infraforge/domain/resource";
import { AsyncSection } from "../src/features/canvas/components/inspector/AsyncSection";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";

const worker = (): Resource => ({ id: "worker", type: "Virtual Machine", x: 0, y: 0, asyncWorker: { ...DEFAULT_ASYNC_WORKER_SETTINGS } });
test("Background worker exposes Off/On result control, exact explanation and run lock", () => {
  const r = worker(), html = renderToStaticMarkup(<AsyncSection resource={r} disabled />);
  expect(html).toContain("Idempotent result writes");
  expect(html).toContain("When enabled, if the same message is processed again, the worker avoids writing the same result object twice.");
  expect(html).toContain('aria-checked="false"');
  expect(html.match(/role="switch"[^>]*disabled/g)).toHaveLength(2);
  r.asyncWorker!.idempotentResults = true;
  expect(renderToStaticMarkup(<AsyncSection resource={r} disabled={false} />).match(/aria-checked="true"/g)).toHaveLength(2);
  r.asyncWorker!.enabled = false;
  expect(renderToStaticMarkup(<AsyncSection resource={r} disabled={false} />)).not.toContain("Idempotent result writes");
  expect(renderToStaticMarkup(<AsyncSection resource={{ id: "queue", type: "Message Queue", x: 0, y: 0, asyncQueue: { ...DEFAULT_ASYNC_QUEUE_SETTINGS } }} disabled={false} />)).not.toContain("Idempotent result writes");
});

test("result intent supports undo/redo, Off, save/reload and both deployment locks", () => {
  try {
    useCanvasStore.getState().clearCanvas();
    const r = worker(); useCanvasStore.setState({ resources: [r], liveLocked: false, isDeploying: false });
    updateResource(r.id, { asyncWorker: { ...r.asyncWorker!, idempotentResults: true } });
    expect(useCanvasStore.getState().resources[0]!.asyncWorker!.idempotentResults).toBe(true);
    undo(); expect(useCanvasStore.getState().resources[0]!.asyncWorker).not.toHaveProperty("idempotentResults");
    redo(); expect(useCanvasStore.getState().resources[0]!.asyncWorker!.idempotentResults).toBe(true);
    for (const locks of [{ liveLocked: true, isDeploying: false }, { liveLocked: false, isDeploying: true }]) {
      useCanvasStore.setState(locks); updateResource(r.id, { asyncWorker: { ...r.asyncWorker!, idempotentResults: false } });
      expect(useCanvasStore.getState().resources[0]!.asyncWorker!.idempotentResults).toBe(true);
    }
    useCanvasStore.setState({ liveLocked: false, isDeploying: false });
    const restored = JSON.parse(JSON.stringify(useCanvasStore.getState().resources)) as Resource[];
    useCanvasStore.setState({ resources: restored });
    expect(useCanvasStore.getState().resources[0]!.asyncWorker!.idempotentResults).toBe(true);
    updateResource(r.id, { asyncWorker: { ...r.asyncWorker!, idempotentResults: false } });
    expect(useCanvasStore.getState().resources[0]!.asyncWorker!.idempotentResults).toBe(false);
  } finally { useCanvasStore.getState().clearCanvas(); useCanvasStore.setState({ liveLocked: false, isDeploying: false }); }
});
