import type { RunReport } from "@infraforge/contracts/reports";
import { ReportSection } from "./ReportSection";

export function ReportMeasurements({ report }: { report: RunReport }) {
  const checkpoint = report.terminal ?? report.checkpoint;
  const monthly = report.stages.findLast((stage) => stage.monthlyEstimateUsd !== undefined)?.monthlyEstimateUsd;
  return <>
    {checkpoint && <ReportSection title={report.terminal ? "Exact terminal simulation snapshot" : "Latest retained simulation checkpoint"}>
      <p className="text-[#8B909C]">{report.terminal ? "Captured from the current simulator state before confirmed teardown. This is the exact state at stop, within the simulation model."
        : checkpoint.capturedAt ? "Diagnostic checkpoint. Its capture time is recorded; it may predate later controls or teardown." : "Legacy diagnostic checkpoint. It may predate the last controls or teardown; its wall-clock capture time was not retained."}</p>
      {checkpoint.capturedAt && <p>Captured <time dateTime={checkpoint.capturedAt}>{new Date(checkpoint.capturedAt).toLocaleString()}</time></p>}
      {checkpoint.topologyRevision !== undefined && <p>Simulator-applied topology revision: {checkpoint.topologyRevision}</p>}
      {checkpoint.metricsComputedAt && <p>Resource measurements last computed <time dateTime={checkpoint.metricsComputedAt}>{new Date(checkpoint.metricsComputedAt).toLocaleString()}</time>
        {checkpoint.metricsTopologyRevision !== undefined && ` on topology revision ${checkpoint.metricsTopologyRevision}`}.</p>}
      {checkpoint.metricsComputedAt === null && <p>Resource measurements are initialized simulator values; no engine tick had computed them.</p>}
      {checkpoint.speed !== undefined && <p>Recorded speed: {checkpoint.speed}×</p>}
      {checkpoint.simulatedSeconds !== undefined && <p>Simulated time recorded: {checkpoint.simulatedSeconds.toLocaleString()} seconds</p>}
      {checkpoint.health && <p>Overall health recorded: {checkpoint.health}</p>}
      {checkpoint.loadFraction !== undefined && <p>Recorded base load multiplier: {Math.round(checkpoint.loadFraction * 100)}% of the declared workload, before traffic bursts</p>}
      {!!checkpoint.resources.length && <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">Retained resource measurements; a dash means unavailable</caption>
          <thead><tr>
            {["Resource", "Health", "CPU", "Memory", "RPS", "Connections"].map((name) =>
              <th className="py-2 pr-4" scope="col" key={name}>{name}</th>)}
          </tr></thead>
          <tbody>{checkpoint.resources.map((resource) => {
            const cells = [resource.id, resource.health ?? "—",
              resource.cpu === undefined ? "—" : `${resource.cpu.toFixed(1)}%`,
              resource.memory === undefined ? "—" : `${resource.memory.toFixed(1)}%`,
              resource.rps?.toFixed(1) ?? "—", resource.connections?.toLocaleString() ?? "—"];
            return <tr key={resource.id}>{cells.map((value, i) =>
              <td className="py-2 pr-4 border-t border-[#2A2E37]" key={i}>{value}</td>)}
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </ReportSection>}
    {(monthly !== undefined || checkpoint?.accumulatedCostUsd !== undefined) && <ReportSection title="Recorded cost estimates">
      {monthly !== undefined && <p>Deployment gate monthly estimate: ${monthly.toFixed(2)} USD</p>}
      {checkpoint?.accumulatedCostUsd !== undefined && <p>Accumulated simulated cost at the {report.terminal ? "exact terminal snapshot" : "retained checkpoint"}: ${checkpoint.accumulatedCostUsd.toFixed(4)} USD</p>}
      <p className="text-[#8B909C]">Different measures: a monthly projection and simulated cost accumulated so far. Neither is a cloud bill or proof of chaos-related cost.</p>
    </ReportSection>}
  </>;
}
