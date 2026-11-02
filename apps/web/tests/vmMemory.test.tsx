import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource } from "@infraforge/domain/resource";
import { VmMemorySection, VmMemoryEditor } from "../src/features/canvas/components/inspector/VmMemorySection";
import { memoryDraft, type MemoryDraft } from "../src/features/canvas/components/inspector/vmMemoryInput";
import { VmMemoryReadings } from "../src/features/live/VmMemoryReadings";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { NodeLive } from "../src/features/live/NodeLive";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const vm: Resource = { id: "app", type: "Virtual Machine", x: 0, y: 0 };
const policy = { version: 1 as const, baselineMiB: 256, requestMiB: 16, activeMiB: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("VM inspector and selected live node expose honest modeled memory controls and Unknown readings", () => {
  const html = renderToStaticMarkup(<Inspector resource={vm} />);
  for (const text of ["Modeled memory", "Baseline MiB", "Per-request MiB", "Extra while running MiB", "A model built from your numbers", 'max="1048576"', "OOM kill, swapping or garbage collection"]) expect(html).toContain(text);
  expect(vm).not.toHaveProperty("vmMemory");
  const locked = renderToStaticMarkup(<VmMemorySection resource={{ ...vm, vmMemory: policy }} disabled />);
  expect(locked.match(/disabled=""/g)).toHaveLength(4);
  const live = renderToStaticMarkup(<NodeLive deploymentId="run" resource={vm} resources={[vm]} controls={false} />);
  expect(live).toContain("Modeled resident memory (from your numbers)");
  expect(renderToStaticMarkup(<VmMemoryReadings />).match(/<dd[^>]*>Unknown<\/dd>/g)).toHaveLength(8);
  const measured = renderToStaticMarkup(<VmMemoryReadings metrics={{ version: 1, resources: [{ id: "app", residentBytes: 1048576, limitBytes: 2097152, headroomBytes: 1048576, holdingRequests: 0, activeRequests: 0, allocationRejected: 0, comparison: "within", peakResidentBytes: 1048576 }] }} />);
  for (const text of ["1 MiB", "2 MiB", ">0</dd>", "Within modeled limit", "grid-cols-2", "min-w-0"]) expect(measured).toContain(text);
});

type InputTree = ReactElement<{ onChange: (e: { target: { value: string } }) => void }>;
type FieldTree = ReactElement<{ children: (ids: { id: string; invalid: boolean }) => InputTree }>;
function editor(draft: MemoryDraft, onDraft: (d: MemoryDraft) => void, disabled = false) {
  return VmMemoryEditor({ resource: useCanvasStore.getState().resources[0]!, draft, onDraft, disabled });
}
function edit(draft: MemoryDraft, field: number, text: string, onDraft: (d: MemoryDraft) => void, disabled = false) {
  const tree = editor(draft, onDraft, disabled);
  const fields = (tree.props.children as ReactElement<{ children: ReactElement[] }>).props.children;
  const inputs = fields[1] as unknown as FieldTree[];
  inputs[field]!.props.children({ id: "memory-test", invalid: false }).props.onChange({ target: { value: text } });
}
test("clearing a field keeps the saved model, shows its range message, and only complete valid drafts commit", () => {
  useCanvasStore.getState().loadLayout([{ ...vm, vmMemory: policy }], [], "layout", "Memory");
  let draft = memoryDraft(policy); const set = (next: MemoryDraft) => { draft = next; };
  edit(draft, 1, "", set);
  expect(useCanvasStore.getState().resources[0]!.vmMemory).toEqual(policy);
  const cleared = renderToStaticMarkup(editor(draft, set)); expect(cleared).toContain('role="alert"'); expect(cleared).toContain("whole number from 0 to 1,048,576"); expect(cleared).toContain('value=""');
  edit(draft, 0, "512", set); expect(useCanvasStore.getState().resources[0]!.vmMemory).toEqual(policy);
  edit(draft, 1, "32", set); expect(useCanvasStore.getState().resources[0]!.vmMemory).toEqual({ ...policy, baselineMiB: 512, requestMiB: 32 });
  undo(); expect(useCanvasStore.getState().resources[0]!.vmMemory).toEqual(policy); redo();
  for (const text of ["-1", "1.5", "1048577"]) { edit(draft, 2, text, set); expect(useCanvasStore.getState().resources[0]!.vmMemory!.activeMiB).toBe(0); }
  edit(memoryDraft(policy), 1, "0", set); expect(renderToStaticMarkup(editor(draft, set))).toContain("must be greater than zero");
});
for (const lock of ["liveLocked", "isDeploying"] as const) test(`memory edits honour ${lock}, wrong owners and background worker mode`, () => {
  useCanvasStore.getState().loadLayout([{ ...vm, vmMemory: policy }], [], "layout", "Memory");
  useCanvasStore.setState({ [lock]: true }); updateResource(vm.id, { vmMemory: undefined });
  edit(memoryDraft(policy), 1, "32", () => {}, true);
  expect(useCanvasStore.getState().resources[0]!.vmMemory).toEqual(policy);
  useCanvasStore.setState({ [lock]: false }); updateResource(vm.id, { asyncWorker: { enabled: true } });
  expect(useCanvasStore.getState().resources[0]!.asyncWorker).toBeUndefined();
  expect(renderToStaticMarkup(<Inspector resource={useCanvasStore.getState().resources[0]} />)).toContain("clear Modeled memory");
  updateResource(vm.id, { vmMemory: undefined }); updateResource(vm.id, { asyncWorker: { enabled: true } }); updateResource(vm.id, { vmMemory: policy });
  expect(useCanvasStore.getState().resources[0]!.vmMemory).toBeUndefined();
  expect(renderToStaticMarkup(<Inspector resource={useCanvasStore.getState().resources[0]} />)).toContain("Background worker VMs are unsupported");
});
for (const vmMemory of [undefined, policy]) test(`memory save and reload ${!!vmMemory}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...vm, ...(vmMemory ? { vmMemory } : {}) }], [], "layout", "Memory");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Memory" } } });
  try {
    await saveDesign(); const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.vmMemory).toEqual(vmMemory);
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Memory");
    expect(useCanvasStore.getState().resources[0]!.vmMemory).toEqual(vmMemory);
  } finally { saved.mockRestore(); }
});
