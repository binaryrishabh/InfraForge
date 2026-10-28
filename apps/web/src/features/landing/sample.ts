import type { Health, SystemHealth, TimetableModel } from "@/features/timetable/model";
import { faultLabel } from "@/features/timetable/fromTrace";
import sample from "./sampleRun.json";

// Produced by scripts/landing-sample.ts from Model 2; see that file for how. CPU is null where Model 2 does not model it.
export interface LandingSample {
  schema: string; model: string;
  challenge: { id: string; version: number; title: string };
  seed: string; workload: string;
  stations: Array<{ id: string; type: string; label: string }>;
  connections: Array<[string, string]>;
  fault: { type: string; target: string; at: number; duration: number };
  evaluation: number;
  points: Array<{ t: number; system: number; resources: Array<[number, number | null]> }>;
}

const HEALTH: Health[] = ["healthy", "degraded", "saturated", "failed", "unknown"];
const SYSTEM: SystemHealth[] = ["healthy", "degraded", "saturated", "critical"];

export const landingSample = sample as LandingSample;

// Every second of the sample was retained, so there are no Unknown windows to draw.
export function landingModel(run: LandingSample = landingSample): TimetableModel {
  const lanes: TimetableModel["lanes"] = {};
  run.stations.forEach((s, i) => {
    lanes[s.id] = { station: s.id, bands: [], samples: run.points.map((p) => ({ t: p.t, health: HEALTH[p.resources[i]![0]]!, cpu: p.resources[i]![1] ?? undefined })) };
  });
  const end = run.evaluation, faultEnd = run.fault.at + run.fault.duration;
  return {
    unit: "s", start: 0, end,
    stations: run.stations.map((s) => ({ id: s.id, label: s.label, type: s.type })),
    lanes,
    system: run.points.map((p) => ({ t: p.t, health: SYSTEM[p.system]! })),
    trains: [],
    windows: [{ from: run.fault.at, to: Math.min(end, faultEnd), kind: "fault", label: `${faultLabel(run.fault.type)} on ${run.fault.target}` }],
    marks: [
      { t: run.fault.at, kind: "fault", label: `${faultLabel(run.fault.type)} ${run.fault.at}s`, station: run.fault.target },
      { t: end, kind: "evaluation", label: `Judged ${end}s` },
    ],
    predictions: [],
    evidence: { complete: true, note: `Every completed tick from 1s to ${end}s.` },
  };
}
