import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { MONITORING_BUFFER_HELP, MONITORING_BATCH_HELP, MONITORING_ATTEMPTS_HELP, type Resource } from "@infraforge/domain/resource";
import { MonitoringBufferSection } from "../src/features/canvas/components/inspector/MonitoringBufferSection";
import { MonitoringCadenceSection } from "../src/features/canvas/components/inspector/MonitoringCadenceSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { undo, redo } from "../src/features/canvas/history";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const monitor: Resource = { id: "monitor", type: "Monitoring Agent", x: 0, y: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });
const resource = () => useCanvasStore.getState().resources[0]!;
function number(value: string, index = 0, cadence = false) {
  const tree = (cadence ? MonitoringCadenceSection : MonitoringBufferSection)({ resource: resource(), disabled: false });
  const field = tree.props.children[index] as ReactElement<{ children(ids: { id: string }): ReactElement<{ onChange(e: { target: { value: string } }): void }> }>;
  field.props.children({ id: "monitor-test" }).props.onChange({ target: { value } });
}
test("inspector exposes bounded buffer, batch and attempts beside cadence with honest explanations", () => {
  const html = renderToStaticMarkup(<Inspector resource={monitor} />);
  for (const text of ["Buffered samples", "Export batch size", "Export attempts", MONITORING_BUFFER_HELP, MONITORING_BATCH_HELP, MONITORING_ATTEMPTS_HELP, "Collect every (seconds)"]) expect(html).toContain(text);
  for (const value of ["1000", "100", "2"]) expect(html).toContain(`placeholder="${value}"`);
  expect(html).toContain('max="8192"'); expect(html).toContain('max="10"');
  expect(html).not.toContain("Buffer bytes");
  expect(renderToStaticMarkup(<Inspector resource={{ ...monitor, type: "Virtual Machine" }} />)).not.toContain("Buffered samples");
});
test("buffer edits preserve cadence, reject overflow without clamping, reset defaults and undo/redo", () => {
  useCanvasStore.getState().loadLayout([monitor], [], "layout", "Monitoring");
  number("2", 0, true); number("4", 1); number("8"); number("3", 2);
  const expected = { version: 2, collectionIntervalSeconds: 2, bufferSamples: 8, batchSamples: 4, exportAttempts: 3 };
  expect(resource().monitoringPolicy).toEqual(expected);
  for (const [index, value] of [[0, "3"], [1, "9"], [0, "8193"], [2, "11"], [0, "0"], [1, "1.5"], [2, "NaN"]] as const) number(value, index);
  expect(resource().monitoringPolicy).toEqual(expected);
  number("60", 1, true); expect(resource().monitoringPolicy).toEqual({ ...expected, exportIntervalSeconds: 60 });
  number("", 0, true); expect(resource().monitoringPolicy?.version).toBe(2);
  expect(renderToStaticMarkup(<MonitoringBufferSection resource={resource()} disabled={false} />)).toContain('max="8"');
  undo(); expect(resource().monitoringPolicy).toBeUndefined(); redo(); expect(resource().monitoringPolicy?.version).toBe(2);
  number(""); number("", 1); number("", 2);
  expect(resource().monitoringPolicy).toEqual({ version: 1, exportIntervalSeconds: 60 });
  number("", 1, true); expect(resource().monitoringPolicy).toBeUndefined();
});
for (const lock of ["liveLocked", "isDeploying"] as const) test(`buffer honors ${lock}`, () => {
  useCanvasStore.getState().loadLayout([monitor], [], "layout", "Monitoring"); useCanvasStore.setState({ [lock]: true });
  number("2000"); number("1", 1); number("3", 2); expect(resource().monitoringPolicy).toBeUndefined();
  expect(renderToStaticMarkup(<MonitoringBufferSection resource={monitor} disabled />).match(/disabled=""/g)).toHaveLength(3);
});
test("v2 policy survives save/reload with cadence and every buffer setting", async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([monitor], [], "layout", "Monitoring"); number("1", 1); number("1"); number("10", 2); number("60", 1, true);
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Monitoring" } } });
  try {
    await saveDesign(); const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.monitoringPolicy).toEqual({ version: 2, bufferSamples: 1, batchSamples: 1, exportAttempts: 10, exportIntervalSeconds: 60 });
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Monitoring");
    expect(resource().monitoringPolicy).toEqual(payload.layout.resources[0]!.monitoringPolicy);
  } finally { saved.mockRestore(); }
});
