/* The timetable is InfraForge's one picture of a run: each resource is a station with a
rail running through time, left to right. What the simulator recorded is drawn solid,
what it did not retain is hatched, and nothing between two records is interpolated.

Runs record per-second resource state, so their timetable has rails and state only.
Trains (individual requests moving between stations) appear only when a recorded causal
journal gives each request an identity; drawing them anywhere else would invent traffic. */

export type Health = "healthy" | "degraded" | "saturated" | "failed" | "unknown";
export type SystemHealth = "healthy" | "degraded" | "saturated" | "critical";
export type TimeUnit = "s" | "us";

export interface Station {
  id: string;
  label: string;
  type: string | null;
}

// One recorded measurement of a station at time t. Missing fields were not recorded.
export interface Sample {
  t: number;
  health: Health;
  cpu?: number;
  memory?: number;
  rps?: number;
  connections?: number;
}

// A recorded interval on one station's rail.
export interface Band {
  from: number;
  to: number;
  kind: "down" | "unready" | "ineligible";
  label: string;
}

export interface Lane {
  station: string;
  samples: Sample[];
  bands: Band[];
}

export interface Stop { t: number; station: string; kind: string }

export interface Train {
  id: string;
  op: string;
  stops: Stop[];
  // What the caller finally recorded. "in-flight" means the horizon ended first.
  outcome: string;
  // Time of a committed DB write on this request's behalf, if one was recorded.
  commitAt: number | null;
  // When the caller's terminal event was recorded; null when it never was.
  endAt: number | null;
}

// Whole-run intervals drawn across every rail.
export interface Window {
  from: number;
  to: number;
  kind: "fault" | "observation" | "unknown";
  label: string;
}

export interface Mark {
  t: number;
  kind: "fault" | "evaluation" | "event";
  label: string;
  station?: string;
}

// The learner's locked answer about one station or the whole system, beside what was recorded.
export interface PredictionMark {
  t: number;
  stations: string[] | "system";
  prompt: string;
  predicted: string;
  recorded: string | null;
  outcome: "matched" | "different" | "unknown";
}

export interface TimetableModel {
  unit: TimeUnit;
  start: number;
  end: number;
  stations: Station[];
  lanes: Record<string, Lane>;
  system: Array<{ t: number; health: SystemHealth }>;
  trains: Train[];
  windows: Window[];
  marks: Mark[];
  predictions: PredictionMark[];
  evidence: { complete: boolean; note: string };
}

export function formatTime(t: number, unit: TimeUnit) {
  if (unit === "s") return `${t}s`;
  return t >= 1000 ? `${(t / 1000).toLocaleString("en", { maximumFractionDigits: 3 })} ms` : `${t} µs`;
}

// The most recent recorded sample at or before t, never a value carried across a gap.
export function sampleAt<T extends { t: number }>(samples: T[], t: number, step: number): T | null {
  let found: T | null = null;
  for (const s of samples) { if (s.t <= t) found = s; else break; }
  return found && t - found.t < step ? found : null;
}
