// Version 1 bounds are product policy, not provider limits. Descriptors are JSON serializable.
export interface InterventionParameter {
  name: string; kind: "number" | "integer" | "boolean" | "enum"; unit: string;
  min?: number; max?: number | "authored-baseline" | "remaining-seconds"; values?: string[];
}
export interface InterventionDescriptor {
  id: string; revision: number; label: string; targetKind: "Database" | "Cache" | "edge";
  mechanism: "relational" | "cache" | "transport"; parameters: InterventionParameter[];
  reversible: boolean; endPolicy: "timed" | "one-shot"; requires: string[];
}
const duration: InterventionParameter = { name: "duration", kind: "integer", unit: "s", min: 1, max: "remaining-seconds" };
export const INTERVENTIONS: readonly InterventionDescriptor[] = [
  { id: "session-capacity", revision: 1, label: "Session capacity", targetKind: "Database", mechanism: "relational",
    parameters: [{ name: "sessions", kind: "integer", unit: "sessions", min: 0, max: 512 }, duration], reversible: true, endPolicy: "timed", requires: ["fixed relational role"] },
  { id: "cpu-capacity", revision: 1, label: "CPU capacity", targetKind: "Database", mechanism: "relational",
    parameters: [{ name: "cores", kind: "number", unit: "cores", min: 0, max: "authored-baseline" }, duration], reversible: true, endPolicy: "timed", requires: ["fixed relational role", "known authored cores"] },
  { id: "flush", revision: 1, label: "Flush cache", targetKind: "Cache", mechanism: "cache",
    parameters: [], reversible: false, endPolicy: "one-shot", requires: ["fixed cache role"] },
  { id: "delay", revision: 1, label: "Edge delay", targetKind: "edge", mechanism: "transport",
    parameters: [{ name: "delay", kind: "integer", unit: "us", min: 0, max: 5_000_000 }, duration], reversible: true, endPolicy: "timed", requires: ["materialized transport links"] },
  { id: "partition", revision: 1, label: "Partition edge", targetKind: "edge", mechanism: "transport",
    parameters: [duration], reversible: true, endPolicy: "timed", requires: ["materialized transport links"] },
];
export type InterventionTarget = { resourceId: string } | { edgeId: string; direction: "request" | "response" | "both" };
export interface InterventionRequest {
  interventionId: string; revision: number; target: InterventionTarget; parameters: Record<string, number | boolean | string>;
}
export interface InterventionBounds { remainingSeconds?: number; authoredBaseline?: number }
export function interventionMaximum(parameter: InterventionParameter, bounds: InterventionBounds = {}): number | undefined {
  if (parameter.max === "remaining-seconds") return Math.min(300, bounds.remainingSeconds ?? 300);
  if (parameter.max === "authored-baseline") return bounds.authoredBaseline;
  return parameter.max;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const simpleId = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
// The same pure check is used at the wire boundary, timeline and materialized engine adapter.
// CPU's contextual upper bound is checked once its authored baseline is available.
export function interventionError(value: unknown, bounds: InterventionBounds = {}): string | null {
  if (!object(value) || Object.keys(value).sort().join() !== "interventionId,parameters,revision,target") return "INTERVENTION_SHAPE: exact versioned fields required";
  const d = INTERVENTIONS.find(d => d.id === value.interventionId);
  if (!d || d.revision !== value.revision) return "INTERVENTION_REVISION: unavailable intervention or revision";
  const t = value.target;
  if (!object(t)) return "INTERVENTION_TARGET: semantic target required";
  if (d.targetKind === "edge" ? Object.keys(t).sort().join() !== "direction,edgeId" || !simpleId(t.edgeId) || !["request", "response", "both"].includes(t.direction as string)
    : Object.keys(t).join() !== "resourceId" || !simpleId(t.resourceId)) return "INTERVENTION_TARGET: target kind or direction is unsupported";
  const p = value.parameters;
  if (!object(p) || Object.keys(p).sort().join() !== d.parameters.map(p => p.name).sort().join()) return "INTERVENTION_PARAMETERS: exact declared parameters required";
  for (const spec of d.parameters) {
    const v = p[spec.name], max = interventionMaximum(spec, bounds);
    if (spec.kind === "boolean" ? typeof v !== "boolean" : spec.kind === "enum" ? !spec.values?.includes(v as string)
      : typeof v !== "number" || !Number.isFinite(v) || (spec.kind === "integer" && !Number.isSafeInteger(v)) || (spec.min !== undefined && v < spec.min) || (max !== undefined && v > max))
      return `INTERVENTION_BOUNDS: ${spec.name} must satisfy product policy (${spec.unit})`;
  }
  return null;
}
