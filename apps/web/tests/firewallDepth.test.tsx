import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { FIREWALL_STATE_HELP, type Resource } from "@infraforge/domain/resource";
import { FirewallStateSection } from "../src/features/canvas/components/inspector/FirewallStateSection";
import { SecurityReadings } from "../src/features/canvas/components/inspector/SecuritySection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { undo, redo } from "../src/features/canvas/history";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const firewall: Resource = { id: "firewall", type: "Firewall", x: 0, y: 0 };
const resource = () => useCanvasStore.getState().resources[0]!;
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });
function number(value: string) {
  const tree = FirewallStateSection({ resource: resource(), disabled: false });
  const field = tree.props.children as ReactElement<{ children(ids: { id: string }): ReactElement<{ onChange(e: { target: { value: string } }): void }> }>;
  field.props.children({ id: "idle timeout-test" }).props.onChange({ target: { value } });
}
test("Firewall inspector shows one bounded idle timeout control and educational explanation", () => {
  const html = renderToStaticMarkup(<Inspector resource={firewall} />);
  for (const text of ["Connection idle timeout (seconds)", FIREWALL_STATE_HELP, 'max="3600"', 'min="1"', 'step="1"', 'placeholder="Until close"']) expect(html).toContain(text);
  expect(renderToStaticMarkup(<Inspector resource={{ ...firewall, type: "Virtual Machine" }} />)).not.toContain("Connection idle timeout (seconds)");
});
test("idle timeout edits reject invalid values, undo/redo, and blank restores profile", () => {
  useCanvasStore.getState().loadLayout([firewall], [], "layout", "Firewall"); number("1");
  for (const value of ["0", "-1", "1.5", "NaN", "3601"]) number(value);
  expect(resource().firewallState).toEqual({ version: 1, idleTimeoutSeconds: 1 });
  undo(); expect(resource().firewallState).toBeUndefined(); redo(); expect(resource().firewallState?.idleTimeoutSeconds).toBe(1);
  number(""); expect(resource().firewallState).toBeUndefined();
});
for (const lock of ["liveLocked", "isDeploying"] as const) test(`firewall idle timeout honors ${lock}`, () => {
  useCanvasStore.getState().loadLayout([firewall], [], "layout", "Firewall"); useCanvasStore.setState({ [lock]: true });
  number("1"); expect(resource().firewallState).toBeUndefined();
  expect(renderToStaticMarkup(<FirewallStateSection resource={resource()} disabled />)).toContain('disabled=""');
});
test("idle timeout survives save and reload", async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([firewall], [], "layout", "Firewall"); number("2");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Firewall" } } });
  try {
    await saveDesign(); const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.firewallState).toEqual({ version: 1, idleTimeoutSeconds: 2 });
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Firewall");
    expect(resource().firewallState).toEqual({ version: 1, idleTimeoutSeconds: 2 });
  } finally { saved.mockRestore(); }
});


test("idle-state readings distinguish pooled request refusals from connection opens", () => {
  const html = renderToStaticMarkup(<SecurityReadings metrics={{ version: 1, evidence: "complete", edges: [{ path: "edge", source: "app", target: "db", admitted: 1, denied: 2, requestDenied: 2, noListener: 0, policyDenied: {}, backendDeliveries: 3 }], firewall: { occupancy: 1, limit: 1, admissions: 2, generation: 3, expired: 1, establishedRequests: 3, newRequests: 2, expiredReturns: 0, "flow-capacity": 0 } }} />);
  expect(html).toContain("denied admissions 2");
  expect(html).toContain("Requests refused on pooled connections: 2");
  expect(html).toContain("Tracked state admissions");
  expect(html).toContain("Expired flow entries");
});
