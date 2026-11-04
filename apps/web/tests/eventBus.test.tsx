import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EventBusSection } from "../src/features/canvas/components/inspector/EventBusSection";
import { EventBusReadings } from "../src/features/live/EventBusReadings";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import type { Resource } from "@infraforge/domain/resource";

afterEach(() => useCanvasStore.getState().clearCanvas());
test("event bus settings survive undo, redo and reload and honor run/deploy locks", () => {
  const bus: Resource = { id: "bus", type: "Event Bus", x: 0, y: 0 };
  useCanvasStore.setState({ resources: [bus], undoStack: [], redoStack: [], liveLocked: false, isDeploying: false });
  const settings = { version: 1 as const, capacityMessages: 2, maxAttempts: 4 };
  updateResource("bus", { eventBus: settings }); expect(useCanvasStore.getState().resources[0]!.eventBus).toEqual(settings);
  undo(); expect(useCanvasStore.getState().resources[0]!.eventBus).toBeUndefined(); redo();
  const saved = JSON.parse(JSON.stringify(useCanvasStore.getState().resources)); useCanvasStore.setState({ resources: saved });
  expect(useCanvasStore.getState().resources[0]!.eventBus).toEqual(settings);
  for (const lock of [{ liveLocked: true, isDeploying: false }, { liveLocked: false, isDeploying: true }]) {
    useCanvasStore.setState(lock); updateResource("bus", { eventBus: undefined }); expect(useCanvasStore.getState().resources[0]!.eventBus).toEqual(settings);
  }
  useCanvasStore.setState({ liveLocked: false, isDeploying: false });
});
test("event bus numeric controls expose defaults, lock state and independent evidence with Unknown gaps", () => {
  const html = renderToStaticMarkup(<EventBusSection resource={{ id: "bus", type: "Event Bus", x: 0, y: 0 }} disabled />);
  expect(html.match(/type="number"/g)).toHaveLength(5); expect(html.match(/disabled=""/g)).toHaveLength(5);
  expect(html).toContain('placeholder="1000"');
  expect(renderToStaticMarkup(<EventBusReadings />)).toContain("Unknown");
  const evidence = renderToStaticMarkup(<EventBusReadings metrics={{ version: 1, accepted: 1, invalid: 0, subscriptions: [{ id: "slow", target: "queue", accepted: 1, delivered: 0, retried: 2, discarded: 0, filtered: 0, pending: 0, deadLettered: 1, deadLetterOverflow: 0 }] }} />);
  expect(evidence).toContain("Subscription slow"); expect(evidence).toContain("<dd>2</dd>"); expect(evidence).toContain("<dd>0</dd>");
  expect(evidence).toContain("Failed attempts</dt><dd>Unknown");
  const measured = renderToStaticMarkup(<EventBusReadings metrics={{ version: 1, accepted: 1, invalid: 0, subscriptions: [{ id: "slow", target: "queue", accepted: 1, delivered: 0, retried: 2, discarded: 0, filtered: 0, pending: 0, deadLettered: 1, deadLetterOverflow: 0, deliveryAccounting: { attempts: 3, failedAttempts: 3, exhausted: 1 } }] }} />);
  expect(measured).toContain("Delivery attempts</dt><dd>3"); expect(measured).toContain("Exhausted deliveries</dt><dd>1");
});
