import { memo } from "react";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { HealthMark } from "@/ui/HealthMark";
import { healthState, type HealthState } from "@/ui/health";
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

/* A station tile: the same pictogram and name the maps and timetables use, then either
the design facts (declared capacity, size, exposure) or the latest recorded measurements.
The rail along the bottom edge carries recorded health the way the timetable does:
thin and quiet when healthy, heavier and warmer as it degrades. */
const RAIL: Record<HealthState, { height: number; color: string }> = {
  healthy: { height: 2, color: "var(--if-line-strong)" }, unknown: { height: 2, color: "var(--if-line-strong)" },
  degraded: { height: 3, color: "var(--if-warn)" }, saturated: { height: 5, color: "var(--if-hot)" },
  failed: { height: 6, color: "var(--if-fail)" }, critical: { height: 6, color: "var(--if-fail)" },
};

function HealthRail({ state }: { state: HealthState }) {
  const { height, color } = RAIL[state];
  // Failed also carries ticks so it reads without colour, as on the timetable.
  const ticks = state === "failed" || state === "critical" ? "repeating-linear-gradient(115deg, transparent 0 7px, var(--if-bg) 7px 8.5px)" : undefined;
  return <span aria-hidden="true" className="absolute inset-x-0 bottom-0" style={{ height, background: ticks ? `${ticks}, ${color}` : color }} />;
}

export const NodeCard = memo(function NodeCard({ resource, mode }: { resource: Resource; mode: "design" | "live" }) {
  const metric = useSimulationStore((s) => (mode === "live" ? s.metrics[resource.id] : undefined));
  const restarting = useSimulationStore((s) => mode === "live" && s.restarting.includes(resource.id));
  const history = useSimulationStore((s) => (mode === "live" ? s.cpuHistory[resource.id] : undefined));
  const activeChaos = useSimulationStore((s) => s.activeChaos);
  const effects = mode === "live" ? activeChaos.filter(c => c.resourceId === resource.id) : [];
  const chaos = effects[0];
  // A resilience attempt's scheduled fault on this resource: before, during and after its window.
  const plan = useExperimentPlan((s) => (s.plan?.target === resource.id ? s.plan : null));
  const seconds = useSimulationStore((s) => (plan && mode === "live" ? s.simulatedSeconds : 0));
  const scheduled = plan && mode === "live" && !chaos && seconds < plan.at ? plan : null;
  const ended = plan && mode === "live" && !chaos && seconds >= plan.at + plan.duration ? plan : null;
  const targeted = plan && mode === "design" ? plan : null;
  const capacity = declaredCapacity(resource);
  const pool = resource.type === RESOURCE_TYPES.LoadBalancer && resource.autoscaling?.enabled !== false;
  const health = metric ? healthState(metric.health) : null;
  const tone = health === "failed" || health === "critical" ? "text-fail" : health === "saturated" ? "text-hot" : health === "degraded" ? "text-warn" : "text-ink";
  return (
    <div className={cx("relative flex flex-col overflow-hidden border bg-surface",
      chaos ? "border-fail if-fault" : restarting ? "border-warn" : scheduled || targeted ? "border-dashed border-ink-3" : "border-line-strong")}
      style={{ minHeight: mode === "design" ? DESIGN_CARD_HEIGHT : NODE_CARD_HEIGHT }}>
      <div className="flex items-start gap-2.5 px-2.5 pt-2.5">
        <span className={cx("flex size-9 shrink-0 items-center justify-center border bg-bg", health && health !== "healthy" ? "border-current border-2" : "border-line-strong", tone)}>
          <ResourceIcon type={resource.type} size={20} className="" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight text-ink" title={resource.name ? `${resource.name} (${resource.id})` : resource.id}>{resource.name || resource.id}</p>
          <p className="truncate text-[11px] text-ink-3">{resource.name ? <span className="if-num">{resource.id}</span> : resource.type}</p>
        </div>
        {mode === "live" && metric && <HealthMark value={metric.health} size="sm" className="mt-0.5 shrink-0" />}
      </div>
      <div className="flex flex-1 flex-col px-2.5 pt-1.5 pb-2.5">
        {mode === "design" ? (
          <div className="mt-auto pt-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="if-num text-[15px] font-semibold text-ink">{capacity.value.toLocaleString()} <span className="text-[11px] text-ink-3">{capacity.unit}</span></span>
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
      {effects.map((chaos, index) => (
        <div key={chaos.intervention?.actionId ?? index} className="if-num flex items-center justify-between border-t border-fail/40 bg-fail-soft px-2.5 py-1 text-[10.5px] font-semibold text-fail">
          <span>{plan && chaos.chaosType === plan.fault ? "Experiment" : "Fault"}: {(chaos.intervention ? `${chaos.intervention.label} ${JSON.stringify(chaos.intervention.parameters)}; restores at ${chaos.intervention.restoreAtUs} us` : CHAOS_LABELS[chaos.chaosType!])}</span><span>{chaos.remainingTicks}s left</span>
        </div>
      ))}
      {targeted && (
        <div className="if-num truncate border-t border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-2" title="The challenge experiment targets this resource">Experiment: {(CHAOS_LABELS[targeted.fault as keyof typeof CHAOS_LABELS] ?? targeted.fault).toLowerCase()} at {targeted.at} s</div>
      )}
      {scheduled && (
        <div className="if-num border-t border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-2">Scheduled: {CHAOS_LABELS[scheduled.fault as keyof typeof CHAOS_LABELS] ?? scheduled.fault} at {scheduled.at} s</div>
      )}
      {ended && (
        <div className="if-num border-t border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-2">Fault ended at {ended.at + ended.duration} s</div>
      )}
      {health && <HealthRail state={health} />}
    </div>
  );
});
