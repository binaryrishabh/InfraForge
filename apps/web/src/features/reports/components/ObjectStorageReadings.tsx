import type { ObjectStorageMetrics } from "@infraforge/contracts/telemetry";

const value = (v: number | boolean | null | undefined) => v == null ? "Unknown" : typeof v === "boolean" ? v ? "Yes" : "No" : v.toLocaleString();

export function ObjectStorageReadings({ id, metrics: m }: { id: string; metrics?: ObjectStorageMetrics }) {
  const readings = [
    ["Object sample time (us)", m?.sampledAtUs],
    ["Object stored bytes (current)", m?.storedBytes],
    ["Object capacity bytes (current)", m?.capacityBytes],
    ["Object over capacity (current)", m?.overCapacity],
    ["Object count (current)", m?.objectCount],
    ["Object generation high-water mark", m?.generation],
    ["Puts reaching capacity check (cumulative)", m?.puts],
    ["Object committed puts (cumulative)", m?.committedPuts],
    ["Object replacements (cumulative)", m?.replacedObjects],
    ["Object removals (cumulative)", m?.removedObjects],
    ["Object delete commands applied (cumulative)", m?.deletes],
    ["Object gets applied (cumulative)", m?.gets],
    ["Object heads applied (cumulative)", m?.heads],
    ["Object response body bytes (cumulative)", m?.generatedResponseBodyBytes],
    ["Object capacity refusals (cumulative)", m?.["object-capacity"]],
    ["Object inventory rows omitted", m?.omittedObjects],
  ] as const;
  return <section aria-label={`Object storage measurements for ${id}`} className="mt-4">
    <h3 className="font-semibold">{id}: object storage</h3>
    <p className="mt-2 text-sm text-ink-3">Cumulative counters cover run start through this sample, not the final second. Current inventory and byte capacity describe that instant only. Generations include initial objects and are not retained versions.</p>
    <dl className="mt-2 grid gap-2 sm:grid-cols-2">{readings.map(([label, v]) => <div key={label}><dt>{label}</dt><dd className="if-num">{value(v)}</dd></div>)}</dl>
    <p className="mt-2 text-sm text-ink-3">Puts reaching capacity check excludes invalid identity, unavailable writes, failed conditions and cancellation before application. Committed puts includes replacements. Applied deletes includes successful no-op deletes. Command reasons below cover all object command kinds; they are not additional put attempts.</p>
    <h4 className="mt-3 font-medium">Object command reasons (cumulative)</h4>
    {m?.commandReasons == null ? <p>Unknown</p> : Object.keys(m.commandReasons).length
      ? <dl>{Object.entries(m.commandReasons).map(([reason, n]) => <div key={reason}><dt>{reason}</dt><dd className="if-num">{value(n)}</dd></div>)}</dl>
      : <p>No reason entries were recorded.</p>}
    <h4 className="mt-3 font-medium">Object inventory (current)</h4>
    {m?.objects == null ? <p>Unknown</p> : m.objects.length ? <div className="overflow-x-auto"><table className="w-full text-sm">
      <caption className="sr-only">Retained object identities, current generation and bytes; at most 100 rows</caption>
      <thead><tr>{["Namespace", "Key", "Object generation (current)", "Object bytes (current)"].map(label => <th key={label} scope="col" className="pr-4 text-left font-medium">{label}</th>)}</tr></thead>
      <tbody>{m.objects.map(o => <tr key={JSON.stringify([o.namespace, o.key])}><th scope="row" className="pr-4 text-left font-normal">{o.namespace}</th><td className="break-all pr-4">{o.key}</td><td className="if-num pr-4">{value(o.generation)}</td><td className="if-num">{value(o.bytes)}</td></tr>)}</tbody>
    </table></div> : <p>No object rows were retained.</p>}
    <p className="mt-2 text-sm text-ink-3">Inventory retains at most 100 namespace/key rows without content. Omitted identities and earlier generations are Unknown. Missing fields, including absent sparse capacity-refusal counts, stay Unknown. This is modeled byte ownership, not physical durability, provider capacity or a transaction with queue acknowledgement.</p>
  </section>;
}
