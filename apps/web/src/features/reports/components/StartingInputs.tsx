import type { StartingComparison } from "@infraforge/contracts/reports";
import { StatusMark } from "@/ui/StatusMark";
import { GRADE_LABEL } from "../labels";

const FACET_LABEL: Record<keyof StartingComparison["facets"], string> = {
  inputVersion: "Input format", model: "Simulation model", catalog: "Catalog", workload: "Workload", seed: "Seed", topology: "Design", resourceOrder: "Resource order",
};
const edge = (e: { sourceId: string; targetId: string; port: number }) => `${e.sourceId} → ${e.targetId}:${e.port}`;

/* Which starting inputs were the same, which differed and which are unknown.
The random-draw alignment note limits what a difference can mean. */
export function StartingInputs({ starting, detailed = false }: { starting: StartingComparison; detailed?: boolean }) {
  const d = starting.design;
  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm">
      <p className="text-[15px] font-semibold text-ink">{GRADE_LABEL[starting.grade]}</p>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {(Object.keys(starting.facets) as Array<keyof StartingComparison["facets"]>).map((field) => {
          const value = starting.facets[field];
          return <li key={field} className="flex items-center justify-between gap-3 border-b border-line py-1"><span className="text-ink-2">{FACET_LABEL[field]}</span>
            <StatusMark size="sm" kind={value === "same" ? "finished" : value === "different" ? "in-progress" : "unknown"} label={value} /></li>;
        })}
      </ul>
      <div>
        <p className="text-ink">Starting-resource random draws: <span className="font-semibold">{starting.alignment.code}</span>.</p>
        {starting.alignment.aligned.length > 0 && <p className="break-words text-ink-2">Same positions: {starting.alignment.aligned.join(", ")}</p>}
        {starting.alignment.shifted.length > 0 && <ul className="mt-1 list-disc pl-5 text-ink-2">{starting.alignment.shifted.map((r) => <li key={r.id} className="break-words">{r.id}: position {r.earlierPosition + 1} → {r.laterPosition + 1}; random draws shifted.</li>)}</ul>}
        <p className="mt-1 text-xs text-ink-3">{starting.alignment.scope}</p>
      </div>
      {detailed && (d ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3 text-ink-2">
          <p>Added resources: {d.added.join(", ") || "none"} · Removed resources: {d.removed.join(", ") || "none"}</p>
          {d.reconfigured.map((r) => <div key={r.id}><p className="font-medium text-ink">{r.id}</p><ul className="list-disc pl-5">{r.fields.map((f) => <li key={f.field} className="break-words">{f.field}: {JSON.stringify(f.earlier)} → {JSON.stringify(f.later)}</li>)}</ul></div>)}
          <p className="break-words">Added connections: {d.addedConnections.map(edge).join(", ") || "none"}</p>
          <p className="break-words">Removed connections: {d.removedConnections.map(edge).join(", ") || "none"}</p>
          {d.resourceOrder && <><p className="break-words">Earlier order: {d.resourceOrder.earlier.join(" → ")}</p><p className="break-words">Later order: {d.resourceOrder.later.join(" → ")}</p></>}
          {d.connectionOrder && <>
            <p>Connection order changed.</p>
            <p className="break-words">Earlier connection order: {d.connectionOrder.earlier.map(edge).join("; ")}</p>
            <p className="break-words">Later connection order: {d.connectionOrder.later.map(edge).join("; ")}</p>
          </>}
          {starting.workload.length > 0 && <ul className="list-disc pl-5">{starting.workload.map((f) => <li key={f.field}>{f.field}: {JSON.stringify(f.earlier)} → {JSON.stringify(f.later)}</li>)}</ul>}
        </div>
      ) : <p className="text-ink-3">Starting design differences are unavailable.</p>)}
    </div>
  );
}
