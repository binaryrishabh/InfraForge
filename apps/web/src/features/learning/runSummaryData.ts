import { evidenceLabels, learningMeasurement } from "@infraforge/contracts/learning";
import type { RunReport } from "@infraforge/contracts/reports";

function entries(value: unknown, path: string[]): Array<{ context: string; value: unknown }> {
  if (!path.length) return [{ context: "", value }];
  if (!value || typeof value !== "object") return [{ context: "", value: undefined }];
  const [key, ...rest] = path;
  if (key === "*") {
    const items = Object.entries(value);
    if (!items.length) return [{ context: "", value: undefined }];
    return items.flatMap(([id, item]) => entries(item, rest).map(row => ({ ...row,
      context: [item && typeof item === "object" && "id" in item ? String(item.id)
        : item && typeof item === "object" && "name" in item ? String(item.name)
        : item && typeof item === "object" && "resourceId" in item ? String(item.resourceId)
        : item && typeof item === "object" && "criterionId" in item ? String(item.criterionId)
        : item && typeof item === "object" && "path" in item ? String(item.path)
        : item && typeof item === "object" && "target" in item ? String(item.target) : id, row.context].filter(Boolean).join(" / ") })));
  }
  return entries((value as Record<string, unknown>)[key!], rest);
}

function recordedValue(value: unknown, unit?: string): string {
  if (value == null || typeof value === "number" && !Number.isFinite(value)) return "Unknown";
  if (typeof value === "object" && "lowMs" in value && "highMs" in value) {
    return `${recordedValue(value.lowMs)}–${recordedValue(value.highMs)} ms`;
  }
  if (typeof value === "boolean") return String(value);
  if (typeof value !== "string" && typeof value !== "number") return "Unknown";
  return `${value}${unit ? ` ${unit}` : ""}`;
}

/** A projection of the existing report, with no evaluator or explanatory model.
 * Never substitute an older checkpoint for missing terminal measurements. */
export function lessonRunMeasurements(report: RunReport, evidence: readonly string[]) {
  const terminal = report.terminal;
  const topology = report.topology.accepted ?? report.topology.original;
  const types = new Map(topology?.resources.map(resource => [resource.id, resource.type]));
  return evidence.flatMap(evidenceLabels).map(label => {
    const definition = learningMeasurement(label);
    if (!definition) return { label, value: "Unknown" };
    if (definition.scope === "monthly") {
      const cost = report.stages.findLast(stage => stage.name === "CostEstimate" && stage.monthlyEstimateUsd !== undefined);
      const rows = entries({ monthlyEstimateUsd: cost?.monthlyEstimateUsd,
        lineItems: report.monthlyBudgets?.length ? cost?.lineItems : undefined,
        monthlyBudgets: report.monthlyBudgets }, definition.path.split("."));
      return { label, value: rows.map(row => `${row.context ? `${row.context}: ` : ""}${recordedValue(row.value, definition.unit)}`).join("; ") };
    }
    if (definition.scope === "snapshot" && (definition.path.startsWith("durationEvidence.") || definition.path.startsWith("dnsEvidence."))) return {label,
      value: entries(terminal, definition.path.split(".")).map(row =>
        `${row.context ? `${row.context}: ` : ""}${recordedValue(row.value, definition.unit)}`).join("; ")};
    if (definition.scope === "traffic" || definition.scope === "snapshot") return { label,
      value: recordedValue(entries(definition.scope === "traffic" ? terminal?.traffic : terminal, definition.path.split("."))[0]?.value, definition.unit) };
    const ids = new Set([
      ...(topology?.resources.filter(resource => !definition.resourceType || resource.type === definition.resourceType).map(resource => resource.id) ?? []),
      ...(terminal?.resources.filter(resource => !definition.resourceType || types.get(resource.id) === definition.resourceType ||
        !types.has(resource.id) && entries(resource, [definition.path.split(".")[0]!])[0]?.value !== undefined).map(resource => resource.id) ?? []),
    ]);
    const rows = [...ids].flatMap(id => entries(terminal?.resources.find(resource => resource.id === id), definition.path.split(".")).map(row =>
      `${id}${row.context ? ` / ${row.context}` : ""}: ${recordedValue(row.value, definition.unit)}`));
    return { label, value: rows.length ? rows.join("; ") : "Unknown" };
  });
}
