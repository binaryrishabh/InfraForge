import type { ChallengeBrief } from "@infraforge/contracts/challenges";
import { StationMap } from "@/features/timetable/StationMap";
import { faultLabel } from "@/features/timetable/fromTrace";
import { cx } from "@/ui/cx";
import { startingPoint } from "../startingPoint";


/* The challenge's starting architecture, drawn the way every run of it will be drawn.
A resilience challenge marks the one resource its experiment will break. */
export function StarterMap({ brief, className, compact = false }: { brief: ChallengeBrief; className?: string; compact?: boolean }) {
  const starter = brief.starter;
  return (
    <figure className={cx("if-paper-grid relative overflow-hidden border border-line bg-canvas", compact ? "p-2" : "p-4", className)}>
      <figcaption className="relative z-10 text-xs text-ink-3">{starter?.resources.length ? "Starting point" : "Starting point: a blank sheet"}<span className="sr-only">. {startingPoint(brief)}</span></figcaption>
      {starter?.resources.length ? (
        <StationMap nodes={starter.resources.map((r) => ({ id: r.id, type: r.type, label: r.name ?? r.id }))}
          edges={starter.connectionLines.map((c) => ({ source: c.sourceId, target: c.targetId }))}
          marked={brief.experiment?.target.resourceId ?? null}
          markLabel={brief.experiment ? `${faultLabel(brief.experiment.fault)} at ${brief.experiment.atSimulatedSecond}s` : undefined}
          label={startingPoint(brief)} className={cx("mx-auto", compact ? "max-h-[220px]" : "mt-2 max-h-[340px]")} />
      ) : <p className="py-10 text-center text-sm text-ink-2">You place every resource.</p>}
    </figure>
  );
}
