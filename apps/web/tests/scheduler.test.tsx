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
