import { useState } from "react";
import { applicationFlowError, FLOW_OPERATIONS, type Resource, type FlowStep, type FlowCall, type FlowOperation } from "@infraforge/domain/resource";
import { updateResource } from "../../actions";
import { useCanvasStore } from "../../store/canvasStore";
import { InspectorSection } from "./InspectorSection";

export function FlowSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const [operation, setOperation] = useState<FlowOperation>("read");
  const edges = useCanvasStore(s => s.connectionLines);
  const resources = useCanvasStore(s => s.resources);
  const connected = edges.filter(e => e.sourceId === resource.id && resources.some(r => r.id === e.targetId && ["Virtual Machine", "Load Balancer"].includes(r.type)));
  const flow = resource.applicationFlow, steps = flow?.operations[operation]?.steps;
  const commit = (rows: FlowStep[] | undefined) => {
    const operations = { ...flow?.operations };
    if (rows) operations[operation] = { steps: rows }; else delete operations[operation];
    updateResource(resource.id, { applicationFlow: Object.keys(operations).length ? { schema: "application-flow/1", operations } : undefined });
  };
  const patch = (index: number, row: FlowStep) => commit(steps!.map((s, i) => i === index ? row : s));
  const call = (): FlowCall => ({ id: crypto.randomUUID(), kind: "call", edge: connected[0]?.id ?? "" });
  const picker = (row: FlowCall, change: (c: FlowCall) => void) => <>
    <select aria-label={`Connected edge ${row.id}`} value={row.edge} onChange={e => change({ ...row, edge: e.target.value })}>
      <option value="">Choose a connected service</option>
      {!connected.some(e => e.id === row.edge) && row.edge && <option value={row.edge}>Missing edge: {row.edge}</option>}
      {connected.map(e => <option key={e.id} value={e.id}>{resources.find(r => r.id === e.targetId)?.name || e.targetId} ({e.id})</option>)}
    </select>
    <select aria-label={`Called operation ${row.id}`} value={row.operation ?? ""} onChange={e => change({ ...row, operation: e.target.value === "" ? undefined : e.target.value as FlowOperation })}>
      <option value="">Same operation</option>{FLOW_OPERATIONS.map(op => <option key={op}>{op}</option>)}
    </select>
  </>;
  const error = applicationFlowError(resource.type, flow);
  const dangling = steps?.flatMap(s => s.kind === "call" ? [s] : s.kind === "parallel" ? s.branches : []).find(c => !connected.some(e => e.id === c.edge));
  return <InspectorSection title="Application flow">
    <p className="text-xs text-ink-3">Authored assumption: thread-per-request: worker held while waiting. Waiting consumes no CPU. Each enclosing retry repeats the whole flow.</p>
    <fieldset disabled={disabled} className="flex flex-col gap-2">
      <select aria-label="Flow operation" value={operation} onChange={e => setOperation(e.target.value as FlowOperation)}>{FLOW_OPERATIONS.map(op => <option key={op}>{op}</option>)}</select>
      <label><input type="checkbox" checked={!!steps} onChange={e => commit(e.target.checked ? [{ id: crypto.randomUUID(), kind: "compute" }] : undefined)} /> Author this operation</label>
      {steps?.map((s, i) => <div key={s.id} className="border border-line p-2">
        <p>{i + 1}. {s.kind}</p>
        {s.kind === "call" && picker(s, c => patch(i, c))}
        {s.kind === "parallel" && <>
          {s.branches.map((b, j) => <div key={b.id}>{picker(b, c => patch(i, { ...s, branches: s.branches.map((v, n) => n === j ? c : v) }))}
            <button type="button" onClick={() => patch(i, { ...s, branches: s.branches.filter((_, n) => n !== j) })}>Remove branch</button></div>)}
          <button type="button" disabled={s.branches.length >= 8} onClick={() => patch(i, { ...s, branches: [...s.branches, call()] })}>Add branch</button>
          <select aria-label={`Join ${s.id}`} value={s.wait === "all" ? "all" : "n"} onChange={e => patch(i, { ...s, wait: e.target.value === "all" ? "all" : 1 })}><option value="all">Wait for all</option><option value="n">Wait for N</option></select>
          {s.wait !== "all" && <input aria-label={`Required responses ${s.id}`} type="number" min={1} max={s.branches.length} value={s.wait} onChange={e => patch(i, { ...s, wait: Number(e.target.value) })} />}
        </>}
        <button type="button" disabled={i === 0} onClick={() => { const rows = [...steps]; [rows[i - 1], rows[i]] = [rows[i]!, rows[i - 1]!]; commit(rows); }}>Move up</button>
        <button type="button" onClick={() => commit(steps.filter((_, n) => n !== i))}>Remove step</button>
      </div>)}
      {steps && (["compute", "call", "parallel"] as const).map(kind => <button key={kind} type="button" disabled={steps.length >= 32} onClick={() => commit([...steps, kind === "compute" ? { id: crypto.randomUUID(), kind } : kind === "call" ? call() : { id: crypto.randomUUID(), kind, branches: [call(), call()], wait: "all" }])}>Add {kind}</button>)}
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {dangling && <p role="alert">Call {dangling.id}: choose an existing connected service edge.</p>}
    {steps?.some(s => s.kind === "parallel" && new Set(s.branches.map(b => b.edge)).size !== s.branches.length) && <p role="alert">Parallel siblings must use distinct service paths.</p>}
    {steps?.some(s => s.kind === "parallel" && s.branches.some(b => (b.operation ?? operation) === "write")) && <p role="alert">Parallel calls must be read-only or idempotent; canvas writes are non-idempotent.</p>}
    {operation === "read" && steps?.some(s => s.kind === "call" && s.operation === "write") && <p role="alert">A read-only flow cannot call the write operation.</p>}
  </InspectorSection>;
}
