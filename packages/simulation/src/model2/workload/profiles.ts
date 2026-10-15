import { validateQuantity, type Quantity, type Unit } from "../../reality/quantity";

export interface ProfileContext { labels: Record<string, string>; quantities: Record<string, Quantity> }
export interface DemandProfile {
  schema: "infraforge-demand/1";
  id: string;
  version: string;
  application: string;
  operation: string;
  stage: "compute" | "database";
  method: "measured" | "derived-measurement" | "fitted" | "bounded" | "synthetic" | "unknown";
  cpu: Quantity<"cpu-us">;
  io: Quantity<"us">;
  obtainedBy: string;
  evidence: string[];
  date: string;
  validity: {
    exact: Record<string, string>;
    ranges: Record<string, { unit: Unit; min: number; max: number; provenance: string[] }>;
  };
  uncertainty: string[];
  freeMode: "forbidden";
}

export function validateProfile(p: DemandProfile): string[] {
  const errors: string[] = [];
  if (p.schema !== "infraforge-demand/1" || !p.id || !p.version || !p.application || !p.operation || !["compute", "database"].includes(p.stage)) errors.push("Invalid profile identity/schema/stage");
  if (!["measured", "derived-measurement", "fitted", "bounded", "synthetic", "unknown"].includes(p.method)) errors.push("Invalid profile method");
  if (!p.obtainedBy || !p.evidence.length || p.evidence.some((v) => !v) || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !p.uncertainty.length || p.freeMode !== "forbidden") errors.push("Profile provenance/limits required; all M2B profiles are internal");
  for (const [q, unit] of [[p.cpu, "cpu-us"], [p.io, "us"]] as const) {
    errors.push(...validateQuantity(q));
    if (q.unit !== unit || (q.kind === "known" && q.value < 0) || (q.kind === "range" && q.min < 0)) errors.push("Invalid demand unit/value");
  }
  if (!Object.keys(p.validity.exact).length || Object.values(p.validity.exact).some((v) => !v)) errors.push("Explicit software/environment validity required");
  for (const r of Object.values(p.validity.ranges)) {
    errors.push(...validateQuantity({ kind: "range", ...r }));
  }
  return errors;
}

export function resolveDemand(p: DemandProfile, operation: string, stage: string, context: ProfileContext) {
  const reasons = validateProfile(p);
  if (p.operation !== operation || p.stage !== stage) reasons.push("Operation/stage mismatch");
  for (const [key, value] of Object.entries(p.validity.exact)) if (context.labels[key] !== value) reasons.push(`Outside exact domain: ${key}`);
  for (const [key, r] of Object.entries(p.validity.ranges)) {
    const q = context.quantities[key];
    if (!q || validateQuantity(q).length || q.kind !== "known" || q.unit !== r.unit || q.value < r.min || q.value > r.max) reasons.push(`Outside bounded domain: ${key}`);
  }
  // Bounds describe knowledge. They do not specify a stochastic demand distribution.
  if (p.cpu.kind !== "known" || p.io.kind !== "known" || p.method === "unknown" || p.method === "bounded") reasons.push("Demand is unresolved; no midpoint or random draw is permitted");
  if (reasons.length) return { kind: "unknown" as const, reason: reasons.join("; "), profile: p.id };
  return { kind: "resolved" as const, cpuUs: p.cpu.kind === "known" ? p.cpu.value : NaN, ioUs: p.io.kind === "known" ? p.io.value : NaN, profile: p.id, version: p.version };
}
