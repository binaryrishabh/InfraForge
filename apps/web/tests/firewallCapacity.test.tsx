import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { FIREWALL_FLOW_CAPACITY_HELP, type Resource } from "@infraforge/domain/resource";
import { FirewallCapacitySection } from "../src/features/canvas/components/inspector/FirewallCapacitySection";
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
  const tree = FirewallCapacitySection({ resource: resource(), disabled: false });
  const field = tree.props.children as ReactElement<{ children(ids: { id: string }): ReactElement<{ onChange(e: { target: { value: string } }): void }> }>;
  field.props.children({ id: "capacity-test" }).props.onChange({ target: { value } });
}
test("Firewall inspector shows one bounded capacity control and educational explanation", () => {
  const html = renderToStaticMarkup(<Inspector resource={firewall} />);
  for (const text of ["Tracked connection limit", FIREWALL_FLOW_CAPACITY_HELP, 'max="100000"', 'min="1"', 'step="1"', 'placeholder="10000 × modeled cores"']) expect(html).toContain(text);
  expect(renderToStaticMarkup(<Inspector resource={{ ...firewall, type: "Virtual Machine" }} />)).not.toContain("Tracked connection limit");
});
test("capacity edits reject invalid values, undo/redo, and blank restores profile", () => {
  useCanvasStore.getState().loadLayout([firewall], [], "layout", "Firewall"); number("1");
  for (const value of ["0", "-1", "1.5", "NaN", "100001"]) number(value);
  expect(resource().firewallCapacity).toEqual({ version: 1, maxFlows: 1 });
  undo(); expect(resource().firewallCapacity).toBeUndefined(); redo(); expect(resource().firewallCapacity?.maxFlows).toBe(1);
  number(""); expect(resource().firewallCapacity).toBeUndefined();
});
for (const lock of ["liveLocked", "isDeploying"] as const) test(`firewall capacity honors ${lock}`, () => {
  useCanvasStore.getState().loadLayout([firewall], [], "layout", "Firewall"); useCanvasStore.setState({ [lock]: true });
  number("1"); expect(resource().firewallCapacity).toBeUndefined();
  expect(renderToStaticMarkup(<FirewallCapacitySection resource={resource()} disabled />)).toContain('disabled=""');
});
test("capacity survives save and reload", async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([firewall], [], "layout", "Firewall"); number("2");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Firewall" } } });
  try {
    await saveDesign(); const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.firewallCapacity).toEqual({ version: 1, maxFlows: 2 });
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Firewall");
    expect(resource().firewallCapacity).toEqual({ version: 1, maxFlows: 2 });
  } finally { saved.mockRestore(); }
});
