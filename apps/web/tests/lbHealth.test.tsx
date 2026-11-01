import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource, LbHealth } from "@infraforge/domain/resource";
import { LbHealthSection } from "../src/features/canvas/components/inspector/LbHealthSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const lb: Resource = { id: "lb", type: "Load Balancer", x: 0, y: 0, name: "Entry", lbAdmission: { version: 1, maxActive: 8 } };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("only load balancers expose four bounded health controls with the original blank defaults", () => {
  const html = renderToStaticMarkup(<Inspector resource={lb} />);
  for (const text of ["Health checks", "Check interval (seconds)", "Check timeout (seconds)", "Failures before unhealthy", "Successes before healthy", "Blank keeps the default.", 'max="60"', 'max="10"', 'placeholder="Default (5)"', 'placeholder="Default (1)"']) expect(html).toContain(text);
  expect(lb).not.toHaveProperty("lbHealth");
  expect(renderToStaticMarkup(<Inspector resource={{ ...lb, type: "Virtual Machine" }} />)).not.toContain("Failures before unhealthy");
});

test("edits preserve other health controls and admission, clearing restores absence", () => {
  useCanvasStore.getState().loadLayout([lb], [], "layout", "Load Balancer");
  const edit = (label: string, value: string) => {
    const tree = LbHealthSection({ resource: useCanvasStore.getState().resources[0]!, disabled: false });
    type InputField = ReactElement<{ label: string; children: (ids: { id: string; invalid: boolean }) => ReactElement<{ onChange: (event: { target: { value: string } }) => void }> }>;
    const fields = tree.props.children.props.children as InputField[];
    fields.find(f => f.props.label === label)!.props.children({ id: "health-test", invalid: false }).props.onChange({ target: { value } });
  };
  edit("Check interval (seconds)", "3"); edit("Check timeout (seconds)", "2"); edit("Failures before unhealthy", "2"); edit("Successes before healthy", "3");
  expect(useCanvasStore.getState().resources[0]!.lbHealth).toEqual({ version: 1, intervalSeconds: 3, timeoutSeconds: 2, unhealthyAfter: 2, healthyAfter: 3 });
  edit("Check interval (seconds)", "1"); // Would overlap the two-second timeout.
  expect(useCanvasStore.getState().resources[0]!.lbHealth?.intervalSeconds).toBe(3);
  edit("Check timeout (seconds)", ""); expect(useCanvasStore.getState().resources[0]!.lbHealth?.unhealthyAfter).toBe(2);
  edit("Check interval (seconds)", ""); edit("Failures before unhealthy", ""); edit("Successes before healthy", "");
  expect(useCanvasStore.getState().resources[0]!.lbHealth).toBeUndefined();
  expect(useCanvasStore.getState().resources[0]!.lbAdmission).toEqual(lb.lbAdmission);
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`health edits support undo/redo, reject invalid values and obey ${lock}`, () => {
  const lbHealth: LbHealth = { version: 1, intervalSeconds: 3, timeoutSeconds: 2, unhealthyAfter: 2, healthyAfter: 2 };
  useCanvasStore.getState().loadLayout([lb], [], "layout", "Load Balancer");
  updateResource("lb", { lbHealth }); undo(); expect(useCanvasStore.getState().resources[0]!.lbHealth).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.lbHealth).toEqual(lbHealth);
  for (const field of ["intervalSeconds", "timeoutSeconds", "unhealthyAfter", "healthyAfter"] as const) for (const n of [0, 1.5, 61]) updateResource("lb", { lbHealth: { ...lbHealth, [field]: n } });
  expect(useCanvasStore.getState().resources[0]!.lbHealth).toEqual(lbHealth);
  useCanvasStore.setState({ [lock]: true }); updateResource("lb", { lbHealth: { version: 1, intervalSeconds: 8 } });
  const saved = useCanvasStore.getState().resources[0]!; expect(saved.lbHealth).toEqual(lbHealth);
  expect(renderToStaticMarkup(<LbHealthSection resource={saved} disabled />).match(/disabled=""/g)).toHaveLength(4);
});

for (const lbHealth of [undefined, { version: 1 as const, intervalSeconds: 1 }, { version: 1 as const, timeoutSeconds: 2 }, { version: 1 as const, unhealthyAfter: 2 }, { version: 1 as const, healthyAfter: 3 }, { version: 1 as const, intervalSeconds: 3, timeoutSeconds: 2, unhealthyAfter: 2, healthyAfter: 3 }]) test(`save/reload retains health and admission: ${JSON.stringify(lbHealth)}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...lb, ...(lbHealth ? { lbHealth } : {}) }], [], "layout", "Load Balancer");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Load Balancer" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[]; connectionLines: [] } };
    expect(payload.layout.resources[0]!.lbHealth).toEqual(lbHealth);
    if (!lbHealth) expect(payload.layout.resources[0]).not.toHaveProperty("lbHealth");
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Load Balancer");
    expect(useCanvasStore.getState().resources[0]!.lbHealth).toEqual(lbHealth);
    expect(useCanvasStore.getState().resources[0]!.lbAdmission).toEqual(lb.lbAdmission);
  } finally { saved.mockRestore(); }
});
