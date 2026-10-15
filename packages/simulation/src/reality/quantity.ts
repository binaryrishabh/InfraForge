export const UNITS = ["us", "seconds", "cpu-us", "cores", "bytes", "GB-label", "kB-label", "kB/s", "Gbps", "count", "requests/s", "requests/hour", "bytes/s", "USD", "USD/month", "USD/s", "ratio", "percent", "port", "code-number", "mixed"] as const;
export type Unit = typeof UNITS[number];
export type Quantity<U extends Unit = Unit> = { unit: U; provenance: string[] } & (
  { kind: "known"; value: number } | { kind: "range"; min: number; max: number } | { kind: "unknown"; reason: string });

export function validateQuantity(q: Quantity): string[] {
  const errors: string[] = [];
  if (!UNITS.includes(q.unit)) errors.push("Unsupported unit");
  if (!q.provenance.length || q.provenance.some((p) => !p.trim())) errors.push("Missing provenance");
  if (q.kind === "known" && !Number.isFinite(q.value)) errors.push("Non-finite value");
  else if (q.kind === "range" && (!Number.isFinite(q.min) || !Number.isFinite(q.max) || q.min > q.max)) errors.push("Invalid range");
  else if (q.kind === "unknown" && !q.reason.trim()) errors.push("Unknown needs a reason");
  else if (!["known", "range", "unknown"].includes(q.kind)) errors.push("Unsupported value kind");
  return errors;
}

export function requireKnown<U extends Unit>(q: Quantity<U>, unit: U): number {
  const errors = validateQuantity(q);
  if (q.unit !== unit) errors.push(`Expected ${unit}`);
  if (errors.length || q.kind !== "known") throw new Error(`Unresolved ${unit}: ${errors.join(", ") || q.kind}`);
  return q.value;
}

// Missing inputs remain missing. A range is an epistemic bound, not a distribution.
export function sumQuantities<U extends Unit>(values: Quantity<U>[], unit: U): Quantity<U> {
  const provenance = [...new Set(values.flatMap((v) => v.provenance))];
  if (!values.length) return { kind: "unknown", unit, provenance: ["missing-input"], reason: "No components supplied" };
  for (const v of values) if (validateQuantity(v).length || v.unit !== unit) throw new Error("Invalid quantity or unit mismatch");
  if (values.some((v) => v.kind === "unknown")) return { kind: "unknown", unit, provenance, reason: "At least one component is unknown" };
  const min = values.reduce((n, v) => n + (v.kind === "known" ? v.value : v.kind === "range" ? v.min : 0), 0);
  const max = values.reduce((n, v) => n + (v.kind === "known" ? v.value : v.kind === "range" ? v.max : 0), 0);
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("Quantity sum overflow");
  return min === max ? { kind: "known", value: min, unit, provenance } : { kind: "range", min, max, unit, provenance };
}
