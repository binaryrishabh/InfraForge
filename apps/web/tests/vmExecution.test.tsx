import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource, VmExecution } from "@infraforge/domain/resource";
import { VmExecutionSection } from "../src/features/canvas/components/inspector/VmExecutionSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const vm: Resource = { id: "vm", type: "Virtual Machine", x: 0, y: 0, name: "Request server" };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("VM inspector exposes only two bounded request controls and retains unset defaults", () => {
  const html = renderToStaticMarkup(<Inspector resource={vm} />);
  for (const text of ["VM execution", "Active workers", "Queued requests", "Active workers process requests. Extra requests wait in this queue. When both are full, new work is refused.", 'max="512"', 'max="1000"', 'placeholder="Default (4)"', 'placeholder="Default (256)"']) expect(html).toContain(text);
  expect(vm).not.toHaveProperty("vmExecution");
  expect(renderToStaticMarkup(<VmExecutionSection resource={{ ...vm, size: "large" }} disabled={false} />)).toContain('placeholder="Default (16)"');
});

test("edits preserve the other limit and other settings, and clearing both restores absence", () => {
  useCanvasStore.getState().loadLayout([vm], [], "layout", "Virtual Machine");
  const edit = (label: string, value: string) => {
    const tree = VmExecutionSection({ resource: useCanvasStore.getState().resources[0]!, disabled: false });
    type InputField = ReactElement<{ label: string; children: (ids: { id: string; invalid: boolean }) => ReactElement<{ onChange: (event: { target: { value: string } }) => void }> }>;
    const fields = tree.props.children.props.children as InputField[];
    fields.find(f => f.props.label === label)!.props.children({ id: "vm-test", invalid: false }).props.onChange({ target: { value } });
  };
  edit("Active workers", "1"); edit("Queued requests", "0");
  expect(useCanvasStore.getState().resources[0]!.vmExecution).toEqual({ version: 1, workers: 1, queuedRequests: 0 });
  edit("Active workers", ""); expect(useCanvasStore.getState().resources[0]!.vmExecution?.queuedRequests).toBe(0);
  edit("Queued requests", ""); expect(useCanvasStore.getState().resources[0]!.vmExecution).toBeUndefined();
  expect(useCanvasStore.getState().resources[0]!.name).toEqual(vm.name);
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`VM edits support undo/redo, reject bad values and obey ${lock}`, () => {
  const vmExecution: VmExecution = { version: 1, workers: 1, queuedRequests: 2 };
  useCanvasStore.getState().loadLayout([vm], [], "layout", "Virtual Machine");
  updateResource("vm", { vmExecution }); undo(); expect(useCanvasStore.getState().resources[0]!.vmExecution).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.vmExecution).toEqual(vmExecution);
  for (const workers of [0, 1.5, 513]) updateResource("vm", { vmExecution: { ...vmExecution, workers } });
  for (const queuedRequests of [-1, 1.5, 1001]) updateResource("vm", { vmExecution: { ...vmExecution, queuedRequests } });
  expect(useCanvasStore.getState().resources[0]!.vmExecution).toEqual(vmExecution);
  useCanvasStore.setState({ [lock]: true }); updateResource("vm", { vmExecution: { version: 1, workers: 8 } });
  const saved = useCanvasStore.getState().resources[0]!; expect(saved.vmExecution).toEqual(vmExecution);
  const html = renderToStaticMarkup(<VmExecutionSection resource={saved} disabled />);
  expect(html).toContain('value="1"'); expect(html).toContain('value="2"'); expect(html.match(/disabled=""/g)).toHaveLength(2);
});

for (const vmExecution of [undefined, { version: 1 as const, workers: 1 }, { version: 1 as const, queuedRequests: 0 }, { version: 1 as const, workers: 8, queuedRequests: 2 }]) test(`save/reload retains explicit settings and absence: ${JSON.stringify(vmExecution)}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...vm, ...(vmExecution ? { vmExecution } : {}) }], [], "layout", "Virtual Machine");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Virtual Machine" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[]; connectionLines: [] } };
    expect(payload.layout.resources[0]!.vmExecution).toEqual(vmExecution);
    if (!vmExecution) expect(payload.layout.resources[0]).not.toHaveProperty("vmExecution");
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Virtual Machine");
    expect(useCanvasStore.getState().resources[0]!.vmExecution).toEqual(vmExecution);
  } finally { saved.mockRestore(); }
});

test("async VMs explain their existing job controls and refuse ineffective saved request limits", () => {
  const worker: Resource = { ...vm, asyncWorker: { enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250 } };
  const html = renderToStaticMarkup(<Inspector resource={worker} />);
  expect(html).toContain("This VM runs queue jobs; its concurrency is set under Background worker.");
  expect(html).not.toContain("Active workers"); expect(html).not.toContain("Queued requests");
  useCanvasStore.getState().loadLayout([worker], [], "layout", "Worker");
  updateResource("vm", { vmExecution: { version: 1, workers: 1 } });
  expect(useCanvasStore.getState().resources[0]!.vmExecution).toBeUndefined();
  useCanvasStore.getState().loadLayout([{ ...vm, vmExecution: { version: 1, workers: 1 } }], [], "layout", "VM");
  updateResource("vm", { asyncWorker: worker.asyncWorker });
  expect(useCanvasStore.getState().resources[0]!.asyncWorker).toBeUndefined();
  expect(renderToStaticMarkup(<Inspector resource={useCanvasStore.getState().resources[0]} />)).toContain("clear VM execution settings");
  updateResource("vm", { vmExecution: undefined }); updateResource("vm", { asyncWorker: worker.asyncWorker });
  expect(useCanvasStore.getState().resources[0]!.asyncWorker?.enabled).toBe(true);
});
