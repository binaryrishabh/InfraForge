import type { VmMemoryMetrics, VmMemoryReading } from "@infraforge/contracts/telemetry";

const bytes = (value: number | null | undefined) => value == null ? "Unknown" : `${Number((value / 1048576).toFixed(3))} MiB`;
export function VmMemoryReadings({ metrics }: { metrics?: VmMemoryMetrics }) {
  const readings: Array<Partial<VmMemoryReading>> = metrics?.resources ?? [{}];
  return <section aria-label="Modeled resident memory (from your numbers)" className="min-w-0 border-b border-line px-4 py-3 text-sm">
    <h3 className="mb-2 font-semibold">Modeled resident memory (from your numbers)</h3>
    {readings.map((r, i) => <div key={r.id ?? i} className="min-w-0">
      {readings.length > 1 && <p className="my-2 break-all font-medium">{r.id}</p>}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{([
        ["Resident", bytes(r.residentBytes)], ["Limit", bytes(r.limitBytes)], ["Headroom", bytes(r.headroomBytes)],
        ["Holding requests", r.holdingRequests ?? "Unknown"], ["Active requests", r.activeRequests ?? "Unknown"], ["Refused allocations", r.allocationRejected ?? "Unknown"],
        ["Status", r.comparison === "within" ? "Within modeled limit" : r.comparison === "exceeds" ? "Exceeds modeled limit" : "Unknown"], ["Peak resident", bytes(r.peakResidentBytes)],
      ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-3">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
    </div>)}
  </section>;
}
