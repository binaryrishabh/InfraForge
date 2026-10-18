import { useEffect, useMemo, useRef, useState } from "react";
import { fitCanvasView } from "@/features/canvas/hooks/useCanvasViewport";
import type { Resource } from "@infraforge/domain/resource";
import { Timetable } from "@/features/timetable/Timetable";
import { fromLiveSnapshots } from "@/features/timetable/fromSnapshots";
import { statesAt } from "@/features/timetable/stationStates";
import { healthLabel } from "@/ui/health";
import type { ExperimentPlan } from "@/features/challenges/experiment";
import { useReceivedSeconds } from "./useReceivedSeconds";

/* The run so far, as a timetable that grows one received second at a time. The cursor
follows the newest second until you move it; then it stays where you put it. */
export function LiveTimetable({ deploymentId, resources, seconds, plan, evaluation }: {
  deploymentId: string; resources: Resource[]; seconds: number; plan: ExperimentPlan | null; evaluation: number | null;
}) {
  const received = useReceivedSeconds(deploymentId);
  const stations = useMemo(() => resources.map((r) => ({ id: r.id, label: r.name || r.id, type: r.type })), [resources]);
  const model = useMemo(() => fromLiveSnapshots({ stations, received, now: seconds, plan, evaluation }), [stations, received, seconds, plan, evaluation]);
  const [pinned, setPinned] = useState<number | null>(null);
  const latest = received.at(-1)?.t ?? null;
  const cursor = pinned ?? latest;
  const states = cursor !== null ? statesAt(model, cursor) : {};
  const notReceived = cursor !== null && !received.some((r) => r.t === cursor);
  // The canvas above shrinks as this grows (the system rail arrives with the first snapshot); keep the architecture in view.
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!section.current) return;
    let last = 0;
    const observer = new ResizeObserver(([entry]) => { const h = Math.round(entry!.contentRect.height); if (h !== last) { last = h; fitCanvasView(); } });
    observer.observe(section.current); return () => observer.disconnect();
  }, []);
  const hot = Object.entries(states).filter(([, s]) => s.health && s.health !== "healthy");
  return (
    <section ref={section} aria-label="Run timetable" className="border-t border-line bg-surface px-3 pt-2 pb-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p role="status" className="min-w-0 truncate text-xs text-ink-3">
          {cursor === null ? "Waiting for the first snapshot."
            : notReceived ? <>Second <span className="if-num text-ink">{cursor}</span> was not received in this view.</>
            : <>Second <span className="if-num text-ink">{cursor}</span>{pinned === null && " (latest)"} · {hot.length ? hot.map(([id, s]) => `${stations.find((x) => x.id === id)?.label ?? id} ${healthLabel(s.health).toLowerCase()}`).join(", ") : "every resource healthy"}</>}
        </p>
        <p className="text-xs text-ink-3">
          {pinned !== null && <button type="button" className="mr-3 font-semibold text-accent hover:underline" onClick={() => setPinned(null)}>Follow the latest second</button>}
          Drawn only from the snapshots this page received.{plan && " The result keeps every second of the experiment window."}
        </p>
      </div>
      <Timetable model={model} cursor={cursor} onCursor={setPinned} compact className="mt-1"
        label="Live run timetable. Arrow keys move between received seconds." />
    </section>
  );
}
