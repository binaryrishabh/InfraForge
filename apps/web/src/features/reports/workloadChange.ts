import type { StartingComparison } from "@infraforge/contracts/reports";

type Difference = StartingComparison["workload"][number];

const ARRIVAL: Record<string, string> = { even: "Even", poisson: "Random (Poisson)" };
const FIELD: Record<string, string> = { targetThroughput: "Configured target rate", throughputUnit: "Throughput unit", trafficShape: "Traffic shape", peakMultiplier: "Peak multiplier",
  readWriteRatio: "Read fraction", payloadSize: "Payload size", clientRetry: "Client retries", workloadObjective: "Service objective" };

const cvLabel = (cv: number) => cv === 0 ? "Fixed (CV 0)" : cv === 0.5 ? "Moderate (CV 0.5)" : cv === 1 ? "High (CV 1)" : `Custom (CV ${cv})`;
// An omitted block means the historical default: even arrivals and fixed application work.
const dynamics = (value: unknown) => {
  const v = (value ?? {}) as { arrivalProcess?: string; applicationCpuCv?: number };
  return { arrival: v.arrivalProcess ?? "even", cv: v.applicationCpuCv ?? 0 };
};
const plain = (value: unknown) => value === null || value === undefined ? "not set" : typeof value === "object" ? JSON.stringify(value) : String(value);

/** The workload differences between two runs in a learner's words, one line per changed setting. */
export function workloadChangeLines(differences: readonly Difference[]): string[] {
  return differences.flatMap(d => {
    if (d.field !== "workloadDynamics") return [`${FIELD[d.field] ?? d.field}: ${plain(d.earlier)} → ${plain(d.later)}`];
    const before = dynamics(d.earlier), after = dynamics(d.later), lines: string[] = [];
    if (before.arrival !== after.arrival) lines.push(`Arrival pattern: ${ARRIVAL[before.arrival] ?? before.arrival} → ${ARRIVAL[after.arrival] ?? after.arrival}`);
    if (before.cv !== after.cv) lines.push(`Application work variability: ${cvLabel(before.cv)} → ${cvLabel(after.cv)}`);
    return lines;
  });
}
