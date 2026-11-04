import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SchedulerSection } from "../src/features/canvas/components/inspector/SchedulerSection";
import { SchedulerReadings } from "../src/features/live/SchedulerReadings";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource, addResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import type { Resource } from "@infraforge/domain/resource";
afterEach(() => useCanvasStore.getState().clearCanvas());
test("scheduler edits persist through undo, redo and reload and honor both locks", () => {
  const timer: Resource = { id: "timer", type: "Scheduler", x: 0, y: 0 };
  useCanvasStore.setState({ resources: [timer], undoStack: [], redoStack: [], liveLocked: false, isDeploying: false });
  const settings = { version: 1 as const, periodMs: 250, overlap: "queue" as const, queueCapacity: 4 };
  updateResource("timer", { scheduler: settings }); expect(useCanvasStore.getState().resources[0]!.scheduler).toEqual(settings);
  undo(); expect(useCanvasStore.getState().resources[0]!.scheduler).toBeUndefined(); redo();
  useCanvasStore.setState({ resources: JSON.parse(JSON.stringify(useCanvasStore.getState().resources)) }); expect(useCanvasStore.getState().resources[0]!.scheduler).toEqual(settings);
  for (const lock of [{ liveLocked: true, isDeploying: false }, { liveLocked: false, isDeploying: true }]) {
    useCanvasStore.setState(lock); updateResource("timer", { scheduler: undefined }); expect(useCanvasStore.getState().resources[0]!.scheduler).toEqual(settings);
  }
  useCanvasStore.setState({ liveLocked: false, isDeploying: false });
  updateResource("timer", { scheduler: { version: 1, periodMs: -1 } }); expect(useCanvasStore.getState().resources[0]!.scheduler).toEqual(settings);
  updateResource("timer", { scheduler: { version: 1, periodMs: undefined } }); expect(useCanvasStore.getState().resources[0]!.scheduler).toEqual({ version: 1 });
});
test("scheduler controls show bounded defaults and lock every setting; missing evidence stays Unknown", () => {
  const html = renderToStaticMarkup(<SchedulerSection resource={{ id: "timer", type: "Scheduler", x: 0, y: 0 }} disabled />);
  expect(html.match(/type="number"/g)).toHaveLength(9); expect(html.match(/disabled=""/g)).toHaveLength(12);
  expect(html).toContain('placeholder="1000"'); expect(html).toContain("One-time");
  expect(renderToStaticMarkup(<SchedulerReadings />)).toContain("Unknown");
});
test("scheduler is placeable after its vertical slice passes", () => {
  useCanvasStore.setState({ resources: [], undoStack: [], redoStack: [], liveLocked: false, isDeploying: false });
  expect(addResource("Scheduler", { x: 0, y: 0 })?.type).toBe("Scheduler");
});

test("scheduler readings distinguish original starts from failed attempts and preserve Unknown in old reports", () => {
  const metrics = { version: 1 as const, due: 1, fired: 3, completed: 0, failed: 1, missed: 1, skippedOverlap: 0, retried: 2, active: 0, queued: 0, retainedLatest: 0, peakActive: 1, peakQueued: 0 };
  expect(renderToStaticMarkup(<SchedulerReadings metrics={metrics} />)).toContain("Original jobs started</dt><dd>Unknown");
  const html = renderToStaticMarkup(<SchedulerReadings metrics={{ ...metrics, attemptAccounting: { started: 1, failedAttempts: 3, timedOutAttempts: 0, pendingAttempts: 0, retryWaiting: 0, delayedStarts: 0, totalStartDelayUs: 0, maxStartDelayUs: 0 } }} />);
  expect(html).toContain("Original jobs started</dt><dd>1"); expect(html).toContain("Failed attempts</dt><dd>3");
  expect(html).toContain("Jobs waiting for retry</dt><dd>0"); expect(html).toContain("start dispatches downstream work");
});
