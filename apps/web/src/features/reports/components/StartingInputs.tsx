import type { StartingComparison } from "@infraforge/contracts/reports";

const labels = { "same-starting-point": "Same starting point", "one-change-design": "One change: design", "one-change-workload": "One change: workload",
  "same-setup-different-seed": "Same setup, different seed", "several-things-changed": "Several things changed", "side-by-side-only": "Side-by-side only" };
export function StartingInputs({ starting, detailed = false }: { starting: StartingComparison; detailed?: boolean }) {
  return <div className="space-y-3 min-w-0">
    <p className="font-medium">{labels[starting.grade]}</p>
    <dl className="space-y-1">{Object.entries(starting.facets).map(([field, result]) => <div key={field} className="flex flex-wrap gap-2"><dt>{field}:</dt><dd>{result}</dd></div>)}</dl>
    <p>Starting-resource jitter: {starting.alignment.code}.</p>
    {!!starting.alignment.aligned.length && <p className="break-words">Same positions: {starting.alignment.aligned.join(", ")}</p>}
    {!!starting.alignment.shifted.length && <ul>{starting.alignment.shifted.map((r) => <li key={r.id} className="break-words">{r.id}: position {r.earlierPosition + 1} → {r.laterPosition + 1}; random draws shifted.</li>)}</ul>}
    <p className="text-sm text-[#8B909C]">{starting.alignment.scope}</p>
    {detailed && <>
      {starting.design ? <><p>Added resources: {starting.design.added.join(", ") || "none"}</p><p>Removed resources: {starting.design.removed.join(", ") || "none"}</p>
        {starting.design.reconfigured.map((r) => <div key={r.id}><p className="font-medium">{r.id}</p><ul>{r.fields.map((f) => <li key={f.field} className="break-words">{f.field}: {JSON.stringify(f.earlier)} → {JSON.stringify(f.later)}</li>)}</ul></div>)}
        <p>Added connections: {starting.design.addedConnections.map((e) => `${e.sourceId} → ${e.targetId}:${e.port}`).join(", ") || "none"}</p>
        <p>Removed connections: {starting.design.removedConnections.map((e) => `${e.sourceId} → ${e.targetId}:${e.port}`).join(", ") || "none"}</p>
        {starting.design.resourceOrder && <><p className="break-words">Earlier order: {starting.design.resourceOrder.earlier.join(" → ")}</p><p className="break-words">Later order: {starting.design.resourceOrder.later.join(" → ")}</p></>}
        {starting.design.connectionOrder && <><p>Connection order changed. Model 1 uses this order for routing and autoscaling pool templates.</p>
          <p className="break-words">Earlier connection order: {starting.design.connectionOrder.earlier.map((e) => `${e.sourceId} → ${e.targetId}:${e.port}`).join("; ")}</p>
          <p className="break-words">Later connection order: {starting.design.connectionOrder.later.map((e) => `${e.sourceId} → ${e.targetId}:${e.port}`).join("; ")}</p></>}
      </> : <p>Starting design differences unavailable.</p>}
      <ul>{starting.workload.map((f) => <li key={f.field}>{f.field}: {JSON.stringify(f.earlier)} → {JSON.stringify(f.later)}</li>)}</ul>
    </>}
  </div>;
}
