import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerlessSection } from "../src/features/canvas/components/inspector/ServerlessSection";
import { ServerlessReadings } from "../src/features/live/ServerlessReadings";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource, addResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import type { Resource } from "@infraforge/domain/resource";
afterEach(() => useCanvasStore.getState().clearCanvas());
test("function settings retain undo, redo and reload, refuse invalid values and honor locks", () => {
  const fn: Resource = { id: "fn", type: "Serverless Function", x: 0, y: 0 };
  useCanvasStore.setState({ resources: [fn], undoStack: [], redoStack: [], liveLocked: false, isDeploying: false });
  const settings = { version: 1 as const, concurrency: 2, initializationMs: 250, idleExpiryMs: 1000 };
  updateResource("fn", { serverless: settings }); expect(useCanvasStore.getState().resources[0]!.serverless).toEqual(settings);
  undo(); expect(useCanvasStore.getState().resources[0]!.serverless).toBeUndefined(); redo();
  useCanvasStore.setState({ resources: JSON.parse(JSON.stringify(useCanvasStore.getState().resources)) }); expect(useCanvasStore.getState().resources[0]!.serverless).toEqual(settings);
  for (const lock of [{ liveLocked: true, isDeploying: false }, { liveLocked: false, isDeploying: true }]) {
    useCanvasStore.setState(lock); updateResource("fn", { serverless: undefined }); expect(useCanvasStore.getState().resources[0]!.serverless).toEqual(settings);
  }
  useCanvasStore.setState({ liveLocked: false, isDeploying: false });
  updateResource("fn", { serverless: { version: 1, concurrency: 129 } }); expect(useCanvasStore.getState().resources[0]!.serverless).toEqual(settings);
  updateResource("fn", { serverless: { version: 1, initializationMs: undefined } }); expect(useCanvasStore.getState().resources[0]!.serverless).toEqual({ version: 1 });
});
test("function controls expose six bounded educational settings, defaults, locks and Unknowns", () => {
  const html = renderToStaticMarkup(<ServerlessSection resource={{ id: "fn", type: "Serverless Function", x: 0, y: 0 }} disabled />);
  expect(html.match(/type="number"/g)).toHaveLength(6); expect(html.match(/disabled=""/g)).toHaveLength(6);
  expect(html).toContain("Educational"); expect(html).toContain('placeholder="100"');
  expect(renderToStaticMarkup(<ServerlessReadings />)).toContain("Unknown");
});
test("functions are placeable after the completed slice passes", () => {
  useCanvasStore.setState({ resources: [], undoStack: [], redoStack: [], liveLocked: false, isDeploying: false });
  expect(addResource("Serverless Function", { x: 0, y: 0 })?.type).toBe("Serverless Function");
});

test("function readings show measured phase durations and preserve Unknown in old reports", () => {
  const metrics = { version: 1 as const, received: 1, admitted: 1, completed: 1, failed: 0, timedOut: 0, cancelled: 0, throttled: 0, unavailable: 0, duplicate: 0, coldStarts: 1, warmStarts: 0, initialized: 1, expired: 0, scaleOut: 0, instances: 1, active: 0, peakInstances: 1, downstreamCalls: 0, downstreamFailed: 0 };
  expect(renderToStaticMarkup(<ServerlessReadings metrics={metrics} />)).toContain("Initialization time (us)</dt><dd>Unknown");
  const html = renderToStaticMarkup(<ServerlessReadings metrics={{ ...metrics, lifecycle: { initializing: 0, executing: 0, downstream: 0, settled: 1, totalDurationUs: 20000, maxDurationUs: 20000, initializationUs: 10000, executionUs: 10000, downstreamUs: 0, busyUs: 20000 } }} />);
  expect(html).toContain("Initialization time (us)</dt><dd>10000"); expect(html).toContain("Total settled duration (us)</dt><dd>20000");
  expect(html).toContain("Database wait time (us)</dt><dd>0"); expect(html).toContain("Phase times include active invocations");
});
