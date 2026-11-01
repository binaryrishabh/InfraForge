import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { VM_CPU_QUOTA_HELP, type Resource } from "@infraforge/domain/resource";
import { VmCpuQuotaSection } from "../src/features/canvas/components/inspector/VmCpuQuotaSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const vm: Resource = { id: "vm", type: "Virtual Machine", x: 0, y: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });
function edit(value: string) {
  const tree = VmCpuQuotaSection({ resource: useCanvasStore.getState().resources[0]!, disabled: false });
  const field = tree.props.children as ReactElement<{ children: (ids: { id: string }) => ReactElement<{ onChange: (e: { target: { value: string } }) => void }> }>;
  field.props.children({ id: "quota-test" }).props.onChange({ target: { value } });
}

test("VM inspector exposes one bounded percentage and the honest quota explanation", () => {
  const html = renderToStaticMarkup(<Inspector resource={vm} />);
  for (const text of ["Application CPU limit (%)", VM_CPU_QUOTA_HELP, "Fixed window: 100 ms", "Worker count, CPU cores, queue size and quota are separate.", 'max="100"', 'placeholder="No quota"']) expect(html).toContain(text);
  expect(vm).not.toHaveProperty("vmCpuQuota");
  useCanvasStore.getState().loadLayout([vm], [], "layout", "VM"); edit("25");
  expect(useCanvasStore.getState().resources[0]!.vmCpuQuota).toEqual({ version: 1, limitPercent: 25 });
  undo(); expect(useCanvasStore.getState().resources[0]!.vmCpuQuota).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.vmCpuQuota?.limitPercent).toBe(25);
  for (const bad of ["0", "101", "1.5"]) edit(bad);
  expect(useCanvasStore.getState().resources[0]!.vmCpuQuota?.limitPercent).toBe(25);
  edit(""); expect(useCanvasStore.getState().resources[0]!.vmCpuQuota).toBeUndefined();
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`CPU quota respects ${lock}`, () => {
  useCanvasStore.getState().loadLayout([vm], [], "layout", "VM"); useCanvasStore.setState({ [lock]: true }); edit("25");
  expect(useCanvasStore.getState().resources[0]!.vmCpuQuota).toBeUndefined();
  expect(renderToStaticMarkup(<VmCpuQuotaSection resource={vm} disabled />)).toContain('disabled=""');
});

test("async worker edits refuse CPU intent until cleared, with an inspector reason", () => {
  const asyncWorker = { enabled: true };
  useCanvasStore.getState().loadLayout([{ ...vm, vmCpuQuota: { version: 1, limitPercent: 25 } }], [], "layout", "VM");
  updateResource(vm.id, { asyncWorker }); expect(useCanvasStore.getState().resources[0]!.asyncWorker).toBeUndefined();
  expect(renderToStaticMarkup(<Inspector resource={useCanvasStore.getState().resources[0]} />)).toContain("clear Application CPU limit");
  edit(""); updateResource(vm.id, { asyncWorker }); updateResource(vm.id, { vmCpuQuota: { version: 1, limitPercent: 25 } });
  expect(useCanvasStore.getState().resources[0]!.vmCpuQuota).toBeUndefined();
  const html = renderToStaticMarkup(<Inspector resource={useCanvasStore.getState().resources[0]} />);
  expect(html).toContain("application CPU quota is available only for request-serving VMs"); expect(html).not.toContain("Application CPU limit (%)");
});

for (const vmCpuQuota of [undefined, { version: 1 as const, limitPercent: 25 }]) test(`quota save/reload: ${JSON.stringify(vmCpuQuota)}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...vm, ...(vmCpuQuota ? { vmCpuQuota } : {}) }], [], "layout", "VM");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "VM" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.vmCpuQuota).toEqual(vmCpuQuota);
    if (!vmCpuQuota) expect(payload.layout.resources[0]).not.toHaveProperty("vmCpuQuota");
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "VM");
    expect(useCanvasStore.getState().resources[0]!.vmCpuQuota).toEqual(vmCpuQuota);
  } finally { saved.mockRestore(); }
});
