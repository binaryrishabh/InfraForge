import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource, LbAdmission } from "@infraforge/domain/resource";
import { LbAdmissionSection } from "../src/features/canvas/components/inspector/LbAdmissionSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const lb: Resource = { id: "lb", type: "Load Balancer", x: 0, y: 0, name: "Entry" };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("load balancer inspector exposes three bounded admission controls and retains unset defaults", () => {
  const html = renderToStaticMarkup(<Inspector resource={lb} />);
  for (const text of ["Load balancer admission", "Active requests", "Queued requests", "Active requests are forwarded at once; queued requests wait for a free slot until the queue wait expires. Blank keeps the default.", 'max="65536"', 'max="100000"', 'max="60000"', 'placeholder="Default (1024)"', 'placeholder="Default (1000)"', 'placeholder="Default (256)"']) expect(html).toContain(text);
  expect(lb).not.toHaveProperty("lbAdmission");
  expect(renderToStaticMarkup(<LbAdmissionSection resource={{ ...lb, size: "large" }} disabled={false} />)).toContain('placeholder="Default (4096)"');
});

test("edits preserve the other limits, and clearing all three restores absence", () => {
  useCanvasStore.getState().loadLayout([lb], [], "layout", "Load Balancer");
  const edit = (label: string, value: string) => {
    const tree = LbAdmissionSection({ resource: useCanvasStore.getState().resources[0]!, disabled: false });
    type InputField = ReactElement<{ label: string; children: (ids: { id: string; invalid: boolean }) => ReactElement<{ onChange: (event: { target: { value: string } }) => void }> }>;
    const fields = tree.props.children.props.children as InputField[];
    fields.find(f => f.props.label === label)!.props.children({ id: "admission-test", invalid: false }).props.onChange({ target: { value } });
  };
  edit("Active requests", "1"); edit("Queued requests", "0"); edit("Queue wait (ms)", "10");
  expect(useCanvasStore.getState().resources[0]!.lbAdmission).toEqual({ version: 1, maxActive: 1, maxQueued: 0, queueWaitMs: 10 });
  edit("Active requests", ""); expect(useCanvasStore.getState().resources[0]!.lbAdmission?.maxQueued).toBe(0);
  edit("Queued requests", ""); edit("Queue wait (ms)", ""); expect(useCanvasStore.getState().resources[0]!.lbAdmission).toBeUndefined();
  expect(useCanvasStore.getState().resources[0]!.name).toEqual(lb.name);
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`admission edits support undo/redo, reject bad values and obey ${lock}`, () => {
  const lbAdmission: LbAdmission = { version: 1, maxActive: 1, maxQueued: 2 };
  useCanvasStore.getState().loadLayout([lb], [], "layout", "Load Balancer");
  updateResource("lb", { lbAdmission }); undo(); expect(useCanvasStore.getState().resources[0]!.lbAdmission).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.lbAdmission).toEqual(lbAdmission);
  for (const maxActive of [0, 1.5, 65537]) updateResource("lb", { lbAdmission: { ...lbAdmission, maxActive } });
  for (const queueWaitMs of [0, 1.5, 60001]) updateResource("lb", { lbAdmission: { ...lbAdmission, queueWaitMs } });
  for (const maxQueued of [-1, 1.5, 100001]) updateResource("lb", { lbAdmission: { ...lbAdmission, maxQueued } });
  expect(useCanvasStore.getState().resources[0]!.lbAdmission).toEqual(lbAdmission);
  useCanvasStore.setState({ [lock]: true }); updateResource("lb", { lbAdmission: { version: 1, maxActive: 8 } });
  const saved = useCanvasStore.getState().resources[0]!; expect(saved.lbAdmission).toEqual(lbAdmission);
  const html = renderToStaticMarkup(<LbAdmissionSection resource={saved} disabled />);
  expect(html).toContain('value="1"'); expect(html).toContain('value="2"'); expect(html.match(/disabled=""/g)).toHaveLength(3);
});

for (const lbAdmission of [undefined, { version: 1 as const, maxActive: 1 }, { version: 1 as const, maxQueued: 0 }, { version: 1 as const, queueWaitMs: 1 }, { version: 1 as const, maxActive: 8, maxQueued: 2, queueWaitMs: 1000 }]) test(`save/reload retains explicit settings and absence: ${JSON.stringify(lbAdmission)}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...lb, ...(lbAdmission ? { lbAdmission } : {}) }], [], "layout", "Load Balancer");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Load Balancer" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[]; connectionLines: [] } };
    expect(payload.layout.resources[0]!.lbAdmission).toEqual(lbAdmission);
    if (!lbAdmission) expect(payload.layout.resources[0]).not.toHaveProperty("lbAdmission");
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Load Balancer");
    expect(useCanvasStore.getState().resources[0]!.lbAdmission).toEqual(lbAdmission);
  } finally { saved.mockRestore(); }
});
