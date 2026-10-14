import { memo } from "react";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { categoryColor } from "@/theme/categories";
import { HealthMark } from "@/ui/HealthMark";
import { cx } from "@/ui/cx";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { CHAOS_LABELS } from "@/features/monitoring/chaosLabels";
import { useExperimentPlan } from "@/features/challenges/experimentPlanStore";
import { DESIGN_CARD_HEIGHT, NODE_CARD_HEIGHT } from "../../utils/nodeGeometry";
import { Sparkline } from "./Sparkline";
import { MeterRow } from "./MeterRow";
import { declaredCapacity } from "./nodeFacts";

function ExposureMarks({ resource }: { resource: Resource }) {
  const marks: string[] = [];
  if (resource.public) marks.push("public");
  if (resource.encryption) marks.push("encrypted");
  if (resource.openPorts?.length) marks.push(resource.openPorts.map((p) => `:${p}`).join(" "));
  if (!marks.length) return null;
  return <p className="if-num mt-1 truncate text-[10.5px] text-ink-3">{marks.join(" · ")}</p>;
}

/* An index card: a type tab with the category colour, the name, and either the
design facts (capacity, size, exposure) or live telemetry. */
export const NodeCard = memo(function NodeCard({ resource, mode }: { resource: Resource; mode: "design" | "live" }) {
  const metric = useSimulationStore((s) => (mode === "live" ? s.metrics[resource.id] : undefined));
  const restarting = useSimulationStore((s) => mode === "live" && s.restarting.includes(resource.id));
  const history = useSimulationStore((s) => (mode === "live" ? s.cpuHistory[resource.id] : undefined));
  const chaos = useSimulationStore((s) => (mode === "live" ? s.activeChaos.find((c) => c.resourceId === resource.id) : undefined));
  // A resilience attempt's scheduled fault on this resource: before, during and after its window.
  const plan = useExperimentPlan((s) => (s.plan?.target === resource.id ? s.plan : null));
  const seconds = useSimulationStore((s) => (plan && mode === "live" ? s.simulatedSeconds : 0));
  const experiment = !!plan && !!chaos && chaos.chaosType === plan.fault;
  const scheduled = plan && mode === "live" && !chaos && seconds < plan.at ? plan : null;
  const ended = plan && mode === "live" && !chaos && seconds >= plan.at + plan.duration ? plan : null;
  const targeted = plan && mode === "design" ? plan : null;
  const capacity = declaredCapacity(resource);
  const pool = resource.type === RESOURCE_TYPES.LoadBalancer && resource.autoscaling?.enabled !== false;
  const color = categoryColor(resource.type);
  return (
    <div className={cx("relative flex flex-col overflow-hidden rounded-md border bg-raised shadow-e1",
      chaos ? "border-fail if-fault" : restarting ? "border-warn" : scheduled || targeted ? "border-dashed border-ink-3" : "border-line-strong")}
      style={{ minHeight: mode === "design" ? DESIGN_CARD_HEIGHT : NODE_CARD_HEIGHT }}>
      <div className="flex h-7 items-center gap-1.5 border-b border-line bg-surface px-2.5" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
        <span style={{ color }} className="inline-flex"><ResourceIcon type={resource.type} size={13} className="" /></span>
        <span className="if-eyebrow min-w-0 flex-1 truncate !text-[10px]">{resource.type}</span>
        {mode === "live" && metric && <HealthMark value={metric.health} size="sm" />}
      </div>
      <div className="flex flex-1 flex-col px-2.5 pt-2 pb-2.5">
        <p className="truncate text-[14px] font-semibold leading-tight text-ink" title={resource.name ? `${resource.name} (${resource.id})` : resource.id}>{resource.name || resource.id}</p>
        {resource.name && <p className="if-num truncate text-[10.5px] text-ink-3">{resource.id}</p>}
        {mode === "design" ? (
          <div className="mt-auto pt-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="if-num text-[15px] text-ink">{capacity.value.toLocaleString()} <span className="text-[11px] text-ink-3">{capacity.unit}</span></span>
              <span className="if-num truncate text-[11px] text-ink-2">{resource.skuId ?? "generic"}</span>
            </div>
            {pool && <p className="if-num mt-0.5 truncate text-[10.5px] text-ink-3">autoscaling · target {resource.autoscaling?.targetCpu ?? SIMULATION_CONSTANTS.AUTOSCALING.DEFAULT_TARGET_CPU}% CPU</p>}
            <ExposureMarks resource={resource} />
          </div>
        ) : !metric ? (
          <p role="status" className="mt-3 text-xs text-ink-3">Waiting for the first measurement…</p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-1">
            <MeterRow label="CPU" value={metric.cpu} />
            <MeterRow label="MEM" value={metric.memory} />
            <div className="if-num flex justify-between text-[10.5px] text-ink-2">
              <span>{metric.rps ?? 0} rps</span>
              {metric.connections !== undefined && <span>{metric.connections} conn</span>}
            </div>
            <Sparkline values={history ?? []} />
            {restarting && <p className="if-num text-[10.5px] font-semibold text-warn">Restarting with new size</p>}
          </div>
        )}
      </div>
      {chaos && (
        <div className="if-num flex items-center justify-between border-t border-fail/40 bg-fail-soft px-2.5 py-1 text-[10.5px] font-semibold text-fail">
          <span>{experiment ? "Experiment" : "Fault"}: {CHAOS_LABELS[chaos.chaosType]}</span><span>{chaos.remainingTicks}s left</span>
        </div>
      )}
      {targeted && (
        <div className="if-num truncate border-t border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-2" title="The challenge experiment targets this resource">Experiment: {(CHAOS_LABELS[targeted.fault as keyof typeof CHAOS_LABELS] ?? targeted.fault).toLowerCase()} at {targeted.at} s</div>
      )}
      {scheduled && (
        <div className="if-num border-t border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-2">Scheduled: {CHAOS_LABELS[scheduled.fault as keyof typeof CHAOS_LABELS] ?? scheduled.fault} at {scheduled.at} s</div>
      )}
      {ended && (
        <div className="if-num border-t border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-2">Fault ended at {ended.at + ended.duration} s</div>
      )}
    </div>
  );
});
