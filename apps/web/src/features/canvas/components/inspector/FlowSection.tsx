import { useState } from "react";
import { applicationFlowError, FLOW_OPERATIONS, type Resource, type FlowStep, type FlowCall, type FlowData, type FlowOperation } from "@infraforge/domain/resource";
import { updateResource } from "../../actions";
import { useCanvasStore } from "../../store/canvasStore";
import { InspectorSection } from "./InspectorSection";

export function FlowSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const [operation, setOperation] = useState<FlowOperation>(resource.applicationFlow?.operations.read ? "read" : resource.applicationFlow?.operations.write ? "write" : "read");
  const edges = useCanvasStore(s => s.connectionLines);
  const resources = useCanvasStore(s => s.resources);
  const connected = edges.filter(e => e.sourceId === resource.id && resources.some(r => r.id === e.targetId && ["Virtual Machine", "Load Balancer"].includes(r.type)));
  const dataEdges = edges.filter(e => e.sourceId === resource.id && resources.some(r => r.id === e.targetId && ["Database", "Cache"].includes(r.type)));
  const publishEdges = edges.filter(e => e.sourceId === resource.id && resources.some(r => r.id === e.targetId && r.type === "Message Queue" && r.asyncQueue?.enabled));
  const flow = resource.applicationFlow, steps = flow?.operations[operation]?.steps;
  const commit = (rows: FlowStep[] | undefined) => {
    const operations = { ...flow?.operations };
    if (rows) operations[operation] = { steps: rows }; else delete operations[operation];
    updateResource(resource.id, { applicationFlow: Object.keys(operations).length ? { schema: flow?.schema === "application-flow/3" || Object.values(operations).some(f => f.steps.some(s => s.kind === "publish")) ? "application-flow/3" : flow?.schema === "application-flow/2" || Object.values(operations).some(f => f.steps.some(s => s.kind === "data")) ? "application-flow/2" : "application-flow/1", operations } : undefined });
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
  const dataPicker = (row: FlowData, change: (c: FlowData) => void) => <>
    <select aria-label={`Data target ${row.id}`} value={row.edge} onChange={e => change({ ...row, edge: e.target.value })}>
      <option value="">Choose an attached database or cache</option>
      {!dataEdges.some(e => e.id === row.edge) && row.edge && <option value={row.edge}>Missing data edge: {row.edge}</option>}
      {dataEdges.map(e => <option key={e.id} value={e.id}>{resources.find(r => r.id === e.targetId)?.name || e.targetId} ({e.id})</option>)}
    </select>
    <select aria-label={`Data operation ${row.id}`} value={row.operation} onChange={e => change({ ...row, operation: e.target.value as FlowOperation })}>
      {FLOW_OPERATIONS.map(op => <option key={op}>{op}</option>)}
    </select>
    <p className="text-xs text-ink-3">Database: read or write the assumed key. Cache: read with database fallback and fill; write updates the database and invalidates. Connect the cache to the same attached database. Data steps run sequentially and are never retried by the flow.</p>
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
        {s.kind === "data" && dataPicker(s, c => patch(i, c))}
        {s.kind === "publish" && <>
          <select aria-label={`Publish edge ${s.id}`} value={s.edge} onChange={e => patch(i, { ...s, edge: e.target.value })}>
            <option value="">Choose an attached upload queue</option>
            {!publishEdges.some(e => e.id === s.edge) && s.edge && <option value={s.edge}>Missing publish edge: {s.edge}</option>}
            {publishEdges.map(e => <option key={e.id} value={e.id}>{resources.find(r => r.id === e.targetId)?.name || e.targetId} ({e.id})</option>)}
          </select>
          <p className="text-xs text-ink-3">Upload object, then publish; wait for broker confirmation of logical ownership. Physical durability Unknown. Worker completion is separate. One sequential write step; no retry or rollback. Use a fixed entry producer and one worker sharing the same object store.</p>
        </>}
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
      {steps && (["compute", "call", "data", "publish", "parallel"] as const).map(kind => <button key={kind} type="button" disabled={steps.length >= 32 || (kind === "publish" && (operation !== "write" || steps.some(s => s.kind === "publish")))} onClick={() => commit([...steps, kind === "compute" ? { id: crypto.randomUUID(), kind } : kind === "call" ? call() : kind === "data" ? { id: crypto.randomUUID(), kind, edge: dataEdges[0]?.id ?? "", operation: "read" } : kind === "publish" ? { id: crypto.randomUUID(), kind, edge: publishEdges[0]?.id ?? "" } : { id: crypto.randomUUID(), kind, branches: [call(), call()], wait: "all" }])}>Add {kind}</button>)}
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {dangling && <p role="alert">Call {dangling.id}: choose an existing connected service edge.</p>}
    {steps?.filter(s => s.kind === "data").map(s => !dataEdges.some(e => e.id === s.edge) && <p key={s.id} role="alert">Data {s.id}: choose an existing attached database or cache edge.</p>)}
    {steps?.filter(s => s.kind === "publish").map(s => !publishEdges.some(e => e.id === s.edge) && <p key={s.id} role="alert">Publish {s.id}: choose an existing attached enabled upload queue edge.</p>)}
    {steps?.some(s => s.kind === "parallel" && new Set(s.branches.map(b => b.edge)).size !== s.branches.length) && <p role="alert">Parallel siblings must use distinct service paths.</p>}
    {steps?.some(s => s.kind === "parallel" && s.branches.some(b => (b.operation ?? operation) === "write")) && <p role="alert">Parallel calls must be read-only or idempotent; canvas writes are non-idempotent.</p>}
    {steps?.some(s => s.kind === "data" && s.operation === "write" && dataEdges.some(e => e.id === s.edge && resources.find(r => r.id === e.targetId)?.type === "Database") && dataEdges.some(e => resources.find(r => r.id === e.targetId)?.type === "Cache")) && <p role="alert">Use a cache write to update the database and invalidate the attached cache.</p>}
    {operation === "read" && steps?.some(s => (s.kind === "call" || s.kind === "data") && s.operation === "write") && <p role="alert">A read-only flow cannot call the write operation.</p>}
  </InspectorSection>;
}
