import type { RunReport } from "@infraforge/contracts/reports";
import { formatDate, formatUsd } from "@/lib/format";
import { HealthMark } from "@/ui/HealthMark";
import { ReportSection } from "./ReportSection";
import { measurementId } from "../resourceFocus";

/* Final state: the exact terminal capture when one exists, otherwise the
latest diagnostic checkpoint, labelled as such. */
export function ReportMeasurements({ report, number }: { report: RunReport; number: number }) {
  const checkpoint = report.terminal ?? report.checkpoint;
  const monthly = report.stages.findLast((stage) => stage.monthlyEstimateUsd !== undefined)?.monthlyEstimateUsd;
  return (
    <>
      {checkpoint && (
        <ReportSection number={number} title={report.terminal ? "Exact terminal simulation snapshot" : "Latest retained simulation checkpoint"}>
          <p className="max-w-[72ch] text-ink-3">{report.terminal ? "Captured from the simulator when the run stopped. This is the exact state at the stop, within the simulation model."
            : checkpoint.capturedAt ? "Diagnostic checkpoint with a recorded capture time. It may predate later controls or the stop."
              : "Legacy diagnostic checkpoint. It may predate the last controls or teardown; its wall-clock capture time was not retained."}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {checkpoint.simulatedSeconds !== undefined && <div><dt className="if-eyebrow">Simulated time</dt><dd className="if-num mt-0.5 text-[17px] text-ink">{checkpoint.simulatedSeconds.toLocaleString()} s</dd></div>}
            {checkpoint.health && <div><dt className="if-eyebrow">Overall health</dt><dd className="mt-1"><HealthMark value={checkpoint.health} /></dd></div>}
            {checkpoint.loadFraction !== undefined && <div><dt className="if-eyebrow">Base load</dt><dd className="if-num mt-0.5 text-[17px] text-ink">{Math.round(checkpoint.loadFraction * 100)}%</dd><dd className="text-[11px] text-ink-3">of the declared workload, before bursts</dd></div>}
            {checkpoint.speed !== undefined && <div><dt className="if-eyebrow">Speed</dt><dd className="if-num mt-0.5 text-[17px] text-ink">{checkpoint.speed}×</dd></div>}
          </dl>
          <p className="mt-3 text-xs text-ink-3">
            {checkpoint.capturedAt && <>Captured <time dateTime={checkpoint.capturedAt}>{formatDate(checkpoint.capturedAt)}</time>. </>}
            {checkpoint.topologyRevision !== undefined && <>Simulator-applied topology revision: {checkpoint.topologyRevision}. </>}
            {checkpoint.metricsComputedAt ? <>Measurements computed <time dateTime={checkpoint.metricsComputedAt}>{formatDate(checkpoint.metricsComputedAt)}</time>{checkpoint.metricsTopologyRevision !== undefined && ` on topology revision ${checkpoint.metricsTopologyRevision}`}.</>
              : checkpoint.metricsComputedAt === null ? "Measurements are initialized simulator values; no engine tick had computed them." : null}
          </p>
          {checkpoint.resources.length > 0 && (
            <div className="mt-4">
              <table className="hidden w-full text-sm sm:table">
                <caption className="sr-only">Recorded resource measurements; a dash means unavailable</caption>
                <thead className="border-b border-line-strong text-left text-xs text-ink-3">
                  <tr>{["Resource", "Health", "CPU", "Memory", "Requests/s", "Connections"].map((h) => <th key={h} scope="col" className="py-2 pr-4 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {checkpoint.resources.map((r) => (
                    <tr key={r.id} id={measurementId(r.id)} tabIndex={-1} className="border-b border-line focus:outline-2 focus:outline-accent">
                      <th scope="row" className="py-2 pr-4 text-left font-medium text-ink">{r.id}</th>
                      <td className="py-2 pr-4">{r.health ? <HealthMark value={r.health} size="sm" /> : "—"}</td>
                      <td className="if-num py-2 pr-4 text-ink">{r.cpu === undefined ? "—" : `${r.cpu.toFixed(1)}%`}</td>
                      <td className="if-num py-2 pr-4 text-ink">{r.memory === undefined ? "—" : `${r.memory.toFixed(1)}%`}</td>
                      <td className="if-num py-2 pr-4 text-ink">{r.rps?.toFixed(1) ?? "—"}</td>
                      <td className="if-num py-2 pr-4 text-ink">{r.connections?.toLocaleString() ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="flex flex-col divide-y divide-line border-y border-line sm:hidden">
                {checkpoint.resources.map((r) => (
                  <li key={r.id} id={measurementId(r.id, true)} tabIndex={-1} className="py-2.5 focus:outline-2 focus:outline-accent">
                    <p className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{r.id}</span>{r.health ? <HealthMark value={r.health} size="sm" /> : <span>—</span>}</p>
                    <p className="if-num mt-0.5 text-xs text-ink-2">CPU {r.cpu === undefined ? "—" : `${r.cpu.toFixed(1)}%`} · Memory {r.memory === undefined ? "—" : `${r.memory.toFixed(1)}%`} · {r.rps?.toFixed(1) ?? "—"} req/s · {r.connections?.toLocaleString() ?? "—"} conn</p>
                  </li>
                ))}
              </ul>
              {report.guidedReview && <a href="#guided-review" className="mt-3 inline-block text-sm font-medium text-accent underline">Back to guided review</a>}
            </div>
          )}
        </ReportSection>
      )}
      {(monthly !== undefined || checkpoint?.accumulatedCostUsd !== undefined) && (
        <ReportSection number={checkpoint ? number + 1 : number} title="Recorded cost estimates">
          <dl className="grid gap-4 sm:grid-cols-2">
            {monthly !== undefined && <div><dt className="if-eyebrow">Monthly estimate (CostEstimate gate)</dt><dd className="if-num mt-0.5 text-[17px] text-ink">{formatUsd(monthly)}</dd></div>}
            {checkpoint?.accumulatedCostUsd !== undefined && <div><dt className="if-eyebrow">Simulated cost so far</dt><dd className="if-num mt-0.5 text-[17px] text-ink">{formatUsd(checkpoint.accumulatedCostUsd, 4)}</dd><dd className="text-[11px] text-ink-3">at the {report.terminal ? "exact terminal snapshot" : "retained checkpoint"}</dd></div>}
          </dl>
          <p className="mt-3 text-xs text-ink-3">Two different measures: a monthly projection and the simulated cost accumulated so far. Neither is a cloud bill or proof of chaos-related cost.</p>
        </ReportSection>
      )}
    </>
  );
}
