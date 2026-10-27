import type { Health, Lane, Mark, Station, SystemHealth, TimetableModel, Window } from "./model";
import { faultLabel } from "./fromTrace";

// One live snapshot as this view received it: the completed second and each resource's state.
export interface ReceivedSecond {
  t: number;
  system: SystemHealth;
  resources: Record<string, { health: Health; cpu: number | null }>;
}

interface LiveInput {
  stations: Station[];
  received: ReceivedSecond[];
  now: number;
  plan?: { fault: string; at: number; duration: number; target: string } | null;
  evaluation?: number | null;
}

/* The live run's timetable, built only from the snapshots this page received. A faster
run, or a page opened mid-run, receives fewer seconds than the simulator ticked; those
seconds stay empty here rather than being filled in. */
export function fromLiveSnapshots({ stations, received, now, plan = null, evaluation = null }: LiveInput): TimetableModel {
  // A fixed frame when the run has a judged second; otherwise a window that pages forward.
  const end = evaluation ?? Math.max(60, Math.ceil((now + 10) / 30) * 30);
  const start = evaluation ? 0 : Math.max(0, end - 180);
  const lanes: Record<string, Lane> = {};
  for (const s of stations) lanes[s.id] = { station: s.id, samples: [], bands: [] };
  const system: TimetableModel["system"] = [];
  for (const second of received) {
    if (second.t < start || second.t > end) continue;
    system.push({ t: second.t, health: second.system });
    for (const [id, r] of Object.entries(second.resources)) lanes[id]?.samples.push({ t: second.t, health: r.health, cpu: r.cpu ?? undefined }); // unknown CPU is not drawn
  }
  const windows: Window[] = [], marks: Mark[] = [];
  if (plan) {
    windows.push({ from: plan.at, to: Math.min(end, plan.at + plan.duration), kind: "fault", label: `${faultLabel(plan.fault)} on ${plan.target}` });
    // Until the clock reaches it, the fault is a plan, not a record.
    marks.push({ t: plan.at, kind: "fault", label: `${faultLabel(plan.fault)} ${now < plan.at ? "due " : ""}${plan.at}s`, station: plan.target });
  }
  if (evaluation) marks.push({ t: evaluation, kind: "evaluation", label: `Judged ${evaluation}s` });
  return {
    unit: "s", start, end, stations: stations.filter((s) => lanes[s.id]), lanes, system, trains: [], windows, marks, predictions: [],
    evidence: { complete: false, note: `${received.length} live ${received.length === 1 ? "snapshot" : "snapshots"} received in this view.` },
  };
}
