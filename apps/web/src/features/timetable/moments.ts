import type { TimetableModel } from "./model";

/* The times a cursor may rest on. A recorded run has one per retained second; a causal run has
one per recorded event, so stepping never lands between two facts that were recorded. */
export function momentsOf(model: TimetableModel): number[] {
  const times = new Set<number>([model.start, model.end]);
  if (model.unit === "s") {
    for (const lane of Object.values(model.lanes)) for (const s of lane.samples) times.add(s.t);
    for (const s of model.system) times.add(s.t);
  } else {
    for (const train of model.trains) for (const stop of train.stops) times.add(stop.t);
    for (const lane of Object.values(model.lanes)) for (const b of lane.bands) { times.add(b.from); times.add(b.to); }
    for (const m of model.marks) times.add(m.t);
  }
  return [...times].filter((t) => t >= model.start && t <= model.end).sort((a, b) => a - b);
}

export function snapTime(model: TimetableModel, t: number, moments = momentsOf(model)) {
  const clamped = Math.max(model.start, Math.min(model.end, t));
  if (model.unit === "s") return Math.round(clamped);
  let best = moments[0] ?? clamped;
  for (const m of moments) if (Math.abs(m - clamped) < Math.abs(best - clamped)) best = m;
  return best;
}
