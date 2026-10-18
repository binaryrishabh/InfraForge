import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { sampleAt, type TimetableModel } from "./model";
import type { StationState } from "./StationMap";

/* Station states for the map at one moment. A station with no retained sample at that
moment gets an explicit null health (drawn as Unknown), never its last known value. */
export function statesAt(model: TimetableModel, t: number): Record<string, StationState> {
  const states: Record<string, StationState> = {};
  for (const s of model.stations) {
    const lane = model.lanes[s.id];
    if (model.unit === "s") {
      const sample = lane ? sampleAt(lane.samples, t, 1) : null;
      states[s.id] = sample ? { health: sample.health, reading: sample.cpu !== undefined ? `CPU ${round(sample.cpu)}%` : undefined } : { health: null, reading: "Not retained" };
    } else {
      const flags = (lane?.bands ?? []).filter((b) => t >= b.from && t < b.to).map((b) => b.label);
      // A causal run records intervals, not a health grade: no flag means nothing was recorded against it.
      states[s.id] = { health: flags.includes("process down") ? "failed" : flags.length ? "degraded" : undefined, flags };
    }
  }
  return states;
}

// The final snapshot of a run without a per-second trace: one recorded moment, nothing else.
export function statesFromCheckpoint(checkpoint: ReportCheckpoint | null): Record<string, StationState> {
  const states: Record<string, StationState> = {};
  for (const r of checkpoint?.resources ?? []) states[r.id] = { health: r.health ?? null, reading: r.cpu !== undefined ? `CPU ${round(r.cpu)}%` : undefined };
  return states;
}

const round = (n: number) => Math.round(n * 10) / 10;
