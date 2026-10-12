import type { RunReport } from "@infraforge/contracts/reports";
import { ReportSection } from "./ReportSection";

export function ReportMeasurements({ report }: { report: RunReport }) {
  const { checkpoint } = report;
  const monthly = report.stages.findLast((stage) => stage.monthlyEstimateUsd !== undefined)?.monthlyEstimateUsd;
  return <>
    {checkpoint && <ReportSection title="Latest retained simulation checkpoint">
      <p className="text-[#8B909C]">Diagnostic snapshot. It may predate the last controls or teardown; its wall-clock capture time was not retained.</p>
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
      {checkpoint?.accumulatedCostUsd !== undefined && <p>Accumulated simulated cost at the retained checkpoint: ${checkpoint.accumulatedCostUsd.toFixed(4)} USD</p>}
      <p className="text-[#8B909C]">Different measures: a monthly projection and simulated cost accumulated so far. Neither is a cloud bill or proof of chaos-related cost.</p>
    </ReportSection>}
  </>;
}
