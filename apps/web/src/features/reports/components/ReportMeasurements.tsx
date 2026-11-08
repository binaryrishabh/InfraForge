import { DatabaseReplicationReadings } from "@/features/live/DatabaseReplicationReadings";
import { DataDeliveryReadings } from "@/features/live/DataDeliveryReadings";
import { ServerlessReadings } from "@/features/live/ServerlessReadings";
import { SchedulerReadings } from "@/features/live/SchedulerReadings";
import { VmMemoryReadings } from "@/features/live/VmMemoryReadings";
import type { RunReport } from "@infraforge/contracts/reports";
import { formatDate, formatUsd } from "@/lib/format";
import { HealthMark } from "@/ui/HealthMark";
import { ReportSection } from "./ReportSection";
import { TrafficEvidence } from "@/features/live/TrafficEvidence";
import { measurementId } from "../resourceFocus";
import { LbAccountingReadings } from "./LbAccountingReadings";
import { SecurityReadings } from "@/features/canvas/components/inspector/SecuritySection";
import { DnsReadings } from "./DnsReadings";
import { DurationReadings } from "./DurationReadings";
import { MonitoringReadings } from "./MonitoringReadings";
import { CdnReadings } from "./CdnReadings";
import { CacheReadings } from "./CacheReadings";
import { QueueReadings } from "./QueueReadings";

/* Final state: the exact terminal capture when one exists, otherwise the
latest diagnostic checkpoint, labelled as such. */
export function ReportMeasurements({ report, number }: { report: RunReport; number: number }) {
  const checkpoint = report.terminal ?? report.checkpoint;
  const cost = report.stages.findLast((stage) => stage.name === "CostEstimate" && stage.monthlyEstimateUsd !== undefined);
  const types = new Map((report.topology.accepted ?? report.topology.original)?.resources.map(r => [r.id, r.type]));
  // The saved topology establishes relevance even when an older capture lacks a reading.
  const resources: NonNullable<RunReport["terminal"]>["resources"] = [...new Set([...(checkpoint?.resources.map(r => r.id) ?? []), ...types.keys()])]
    .map(id => checkpoint?.resources.find(r => r.id === id) ?? {id});
  const hasCache = [...types.values()].includes("Cache") || resources.some(r => r.cache);
  const hasDns = checkpoint?.dnsEvidence
    ? !!checkpoint.dnsEvidence.resolvers.length || checkpoint.dnsEvidence.resolversOmitted > 0
    : [...types.values()].includes("DNS");
  const hasDurations = !!checkpoint?.durationEvidence || [...types.values()].some(type => ["Virtual Machine", "Database"].includes(type));
  const monitoringResources = [...new Set([
    ...[...types].filter(([, type]) => type === "Monitoring Agent").map(([id]) => id),
    ...(checkpoint?.resources.filter(r => r.monitoring || r.monitoringBackend).map(r => r.id) ?? []),
  ])].map(id => checkpoint?.resources.find(r => r.id === id) ?? {id});
  const monthly = cost?.monthlyEstimateUsd;
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
          {checkpoint.traffic && <div className="mt-5 min-w-0">
            <h3 className="text-[17px] font-semibold text-ink">Traffic outcomes</h3>
            <TrafficEvidence traffic={checkpoint.traffic} recordedAt={report.terminal ? "stop" : "checkpoint"} />
          </div>}
          {resources.length > 0 && (
            <div className="mt-4">
              {checkpoint.resources.length > 0 && <>
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
              </>}
              {resources.filter(r => r.database || r.databaseReplication || r.serverless || r.scheduler || r.eventBus || r.gateway || r.lbAccounting || ["Database", "Serverless Function", "Scheduler", "Event Bus", "API Gateway", "Load Balancer"].includes(types.get(r.id) ?? "")).map(r => <section key={r.id} aria-label={`Resource measurements for ${r.id}`} className="mt-4"><h3 className="font-semibold">{r.id}</h3>{(r.database || types.get(r.id) === "Database") && <DataDeliveryReadings type="Database" metrics={r} resourceId={r.id} />}{r.databaseReplication && <DatabaseReplicationReadings metrics={r} resourceId={r.id} />}{(r.serverless || types.get(r.id) === "Serverless Function") && <ServerlessReadings metrics={r.serverless} resourceId={r.id} />}{(r.scheduler || types.get(r.id) === "Scheduler") && <SchedulerReadings metrics={r.scheduler} resourceId={r.id} />}{(r.eventBus || types.get(r.id) === "Event Bus") && <EventBusReadings metrics={r.eventBus} resourceId={r.id} />}{(r.gateway || types.get(r.id) === "API Gateway") && <GatewayReadings metrics={r.gateway} resourceId={r.id} />}{r.lbAccounting ? <LbAccountingReadings metrics={r.lbAccounting} /> : types.get(r.id) === "Load Balancer" && <p>Load balancer accounting: Unknown</p>}</section>)}
              {resources.filter(r => r.cdn || types.get(r.id) === "CDN").map(r => <CdnReadings key={`cdn-${r.id}`} resource={r} />)}
              {resources.filter(r => r.cache || r.applicationHelpers?.helpers.length || types.get(r.id) === "Cache" || (!r.applicationHelpers && hasCache && types.get(r.id) === "Virtual Machine")).map(r => <CacheReadings key={`cache-${r.id}`} resource={r} cache={!!r.cache || types.get(r.id) === "Cache"} />)}
              {checkpoint.resources.filter(r => r.security).map(r => <section key={`security-${r.id}`} aria-label={`Security measurements for ${r.id}`} className="mt-4"><h3 className="font-semibold">{r.id}: security measurements</h3><SecurityReadings metrics={r.security} /></section>)}
              {resources.filter(r => r.queueWork || r.asyncQueue || types.get(r.id) === "Message Queue").map(r => <QueueReadings key={`queue-${r.id}`} resource={r} />)}
              {checkpoint.resources.filter(r => r.vmMemory).map(r => <section key={`memory-${r.id}`} aria-label={`Memory measurements for ${r.id}`} className="mt-4"><h3 className="font-semibold">{r.id}: memory measurements</h3><VmMemoryReadings metrics={r.vmMemory} resourceId={r.id} headingLevel={4} /></section>)}
              {report.guidedReview && <a href="#guided-review" className="mt-3 inline-block text-sm font-medium text-accent underline">Back to guided review</a>}
            </div>
          )}
          {hasDns && <DnsReadings evidence={checkpoint.dnsEvidence} />}
          {hasDurations && <DurationReadings evidence={checkpoint.durationEvidence} />}
          {monitoringResources.map(r => <MonitoringReadings key={`monitor-${r.id}`} resource={r} />)}
        </ReportSection>
      )}
      {(monthly !== undefined || checkpoint?.accumulatedCostUsd !== undefined || !!report.monthlyBudgets?.length) && (
        <ReportSection number={checkpoint ? number + 1 : number} title="Recorded cost estimates">
          <dl className="grid gap-4 sm:grid-cols-2">
            {monthly !== undefined && <div><dt className="if-eyebrow">Monthly estimate (CostEstimate gate)</dt><dd className="if-num mt-0.5 text-[17px] text-ink">{formatUsd(monthly)}</dd></div>}
            {checkpoint?.accumulatedCostUsd !== undefined && <div><dt className="if-eyebrow">Simulated cost so far</dt><dd className="if-num mt-0.5 text-[17px] text-ink">{formatUsd(checkpoint.accumulatedCostUsd, 4)}</dd><dd className="text-[11px] text-ink-3">at the {report.terminal ? "exact terminal snapshot" : "retained checkpoint"}</dd></div>}
          </dl>
          {report.monthlyBudgets?.map(budget => <div key={budget.criterionId} className="mt-4">
            <h3 className="font-semibold">{budget.label}</h3>
            <dl className="mt-2 grid gap-4 sm:grid-cols-2">
              <div><dt className="if-eyebrow">Monthly budget limit</dt><dd className="if-num">{formatUsd(budget.limitUsd)}</dd></div>
              <div><dt className="if-eyebrow">Remaining monthly budget</dt><dd className="if-num">{budget.remainingUsd === undefined ? "Unknown" : `${budget.remainingUsd < 0 ? "-" : ""}${formatUsd(Math.abs(budget.remainingUsd))}`}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-ink-3">Limit minus the recorded monthly estimate; a negative amount is over budget. This is a projection, not an account balance.</p>
          </div>)}
          {(!!report.monthlyBudgets?.length || !!cost?.lineItems?.length) && <div className="mt-4">
            <h3 className="font-semibold">Monthly resource price line items</h3>
            {cost?.lineItems ? <div className="overflow-x-auto"><table className="w-full text-sm">
              <caption className="sr-only">Recorded CostEstimate line items, not current catalog prices</caption>
              <thead className="border-b border-line-strong text-left text-xs text-ink-3"><tr>{["Resource", "Type", "Recorded size", "Monthly estimate"].map(label => <th key={label} scope="col" className="py-2 pr-4 font-medium">{label}</th>)}</tr></thead>
              <tbody>{cost.lineItems.map(item => <tr key={item.resourceId} className="border-b border-line">
                <th scope="row" className="py-2 pr-4 text-left font-medium">{item.resourceId}</th><td className="py-2 pr-4">{item.type}</td>
                <td className="py-2 pr-4">{item.skuId ? <>{item.provider && `${item.provider} · `}{item.skuLabel ?? item.skuId}{item.skuLabel && ` (${item.skuId})`}</> : "Generic educational estimate"}</td>
                <td className="if-num py-2 pr-4">{formatUsd(item.monthlyUsd)}</td>
              </tr>)}</tbody>
            </table></div> : <p className="mt-2 text-sm text-ink-3">Unknown: no usable resource price line items were retained.</p>}
            <p className="mt-2 text-xs text-ink-3">Prices were retained by this run's CostEstimate gate. Catalog snapshot figures are not a quote; later size changes and runtime scaling costs are not priced here.</p>
          </div>}
          <p className="mt-3 text-xs text-ink-3">Two different measures: a monthly projection and the simulated cost accumulated so far. Neither is a cloud bill or proof of chaos-related cost.</p>
        </ReportSection>
      )}
    </>
  );
}
import { EventBusReadings } from "@/features/live/EventBusReadings";
import { GatewayReadings } from "@/features/live/GatewayReadings";
