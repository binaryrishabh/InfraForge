import type { RerunOptions, WorkloadVariant, WorkloadVariantSource } from "@infraforge/contracts/reports";

type Choice = RerunOptions["workloadVariant"]["choices"][number];

// Same names the run dialog's workload controls use, so a learner sees one vocabulary.
const ARRIVAL: Record<WorkloadVariantSource["arrivalProcess"], string> = { even: "Even", poisson: "Random (Poisson)" };
const WORK: Record<WorkloadVariantSource["applicationCpuVariability"], string> = { fixed: "Fixed (CV 0)", moderate: "Moderate (CV 0.5)", high: "High (CV 1)", custom: "Custom" };
const DIMENSION = { "arrival-process": "Arrival pattern", "application-cpu-variability": "Application work variability" } as const;

export const variantKey = (v: WorkloadVariant) => `${v.dimension}:${v.value}`;
export const variantValueLabel = (v: WorkloadVariant) => v.dimension === "arrival-process" ? ARRIVAL[v.value] : WORK[v.value];
export const variantDimensionLabel = (v: WorkloadVariant) => DIMENSION[v.dimension];

export interface VariantGroup { dimension: WorkloadVariant["dimension"]; legend: string; current: string; choices: Array<Choice & { key: string; label: string; isCurrent: boolean }> }

/** One group per workload dimension, in the order the run dialog shows them. The server decides what is available. */
export function variantGroups(options: RerunOptions["workloadVariant"]): VariantGroup[] {
  const source = options.source;
  return (["arrival-process", "application-cpu-variability"] as const).map(dimension => {
    const current = !source ? "Unknown" : dimension === "arrival-process" ? ARRIVAL[source.arrivalProcess] : WORK[source.applicationCpuVariability];
    const choices = options.choices.filter(c => c.variant.dimension === dimension).map(c => ({
      ...c, key: variantKey(c.variant), label: variantValueLabel(c.variant), isCurrent: c.reason === "Already the source setting." }));
    return { dimension, legend: DIMENSION[dimension], current, choices };
  }).filter(group => group.choices.length > 0);
}

/** The single change a learner is about to make, in words: "Arrival pattern: Even to Random (Poisson)". */
export function describeVariantChange(options: RerunOptions["workloadVariant"], variant: WorkloadVariant) {
  const group = variantGroups(options).find(g => g.dimension === variant.dimension);
  return { dimension: variantDimensionLabel(variant), from: group?.current ?? "Unknown", to: variantValueLabel(variant) };
}

// What a workload variant keeps from its source run. The server enforces each line; this only says so.
export const UNCHANGED = [
  "The captured design and every resource setting",
  "The seed",
  "The request rate and every other workload setting",
  "The simulator and catalog version",
] as const;

/** Whether the form may start a run, and if not, the visible reason. Exactly one available setting must be selected. */
export function experimentSubmission(options: RerunOptions["workloadVariant"], selected: string | null, blocked: string | null) {
  const choice = variantGroups(options).flatMap(g => g.choices).find(c => c.key === selected) ?? null;
  const change = choice ? describeVariantChange(options, choice.variant) : null;
  const ready = !!choice && choice.available && !!choice.inputHash && !blocked;
  return { choice, change, ready, reason: ready ? null : blocked ?? (choice && !choice.available ? choice.reason ?? "That setting is not available." : "Choose one setting to change before starting.") };
}

export const SAME_SEED_NOTE = "The same seed does not mean the same requests. A different arrival pattern or work variability changes when requests arrive and how long they take, so compare the recorded outcomes of the two runs, not individual requests.";
