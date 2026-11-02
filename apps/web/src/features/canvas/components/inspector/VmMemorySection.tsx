import { useState } from "react";
import { VM_MEMORY_HELP, VM_MEMORY_MAX_MIB, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";
import { memoryDraft, parseMemoryDraft, type MemoryDraft } from "./vmMemoryInput";

export function VmMemorySection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const saved = JSON.stringify(resource.vmMemory);
  const [seen, setSeen] = useState(saved), [draft, setDraft] = useState(() => memoryDraft(resource.vmMemory));
  // Saved edits, undo/redo and reload replace the local draft during render.
  if (seen !== saved) { setSeen(saved); setDraft(memoryDraft(resource.vmMemory)); }
  return <VmMemoryEditor resource={resource} disabled={disabled} draft={draft} onDraft={setDraft} />;
}

export function VmMemoryEditor({ resource, disabled, draft, onDraft }: { resource: Resource; disabled: boolean; draft: MemoryDraft; onDraft: (draft: MemoryDraft) => void }) {
  const p = resource.vmMemory, parsed = parseMemoryDraft(draft);
  const edit = (key: keyof MemoryDraft, text: string) => {
    if (disabled || !p) return;
    const next = { ...draft, [key]: text }; onDraft(next);
    const result = parseMemoryDraft(next);
    if (result.value) updateResource(resource.id, { vmMemory: result.value });
  };
  return <InspectorSection title="Modeled memory" hint={VM_MEMORY_HELP}>
    {resource.asyncWorker?.enabled ? <p className="text-sm text-ink-3">Modeled memory supports request-serving Virtual Machines, including application-flow and upload-producer VMs. Background worker VMs are unsupported.</p> : <div className="flex min-w-0 flex-col gap-4">
      <label className="text-sm"><input type="checkbox" checked={!!p} disabled={disabled} onChange={e => updateResource(resource.id, { vmMemory: e.target.checked ? { version: 1, baselineMiB: 256, requestMiB: 16, activeMiB: 0 } : undefined })} /> Model resident memory</label>
      {([["baselineMiB", "Baseline MiB"], ["requestMiB", "Per-request MiB"], ["activeMiB", "Extra while running MiB"]] as const).map(([key, label]) => <Field key={key} label={label} error={p ? parsed.errors[key] : null}>
        {({ id, describedBy, invalid }) => <Input id={id} type="number" min={0} max={VM_MEMORY_MAX_MIB} step={1} value={p ? draft[key] : ""} disabled={disabled || !p} aria-describedby={describedBy} aria-invalid={invalid} placeholder="Model off" onChange={e => edit(key, e.target.value)} />}
      </Field>)}
    </div>}
  </InspectorSection>;
}
