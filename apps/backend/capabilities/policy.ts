import { AppError } from "../utils/errors";

export type CapabilityRequest =
  | { capability: "run.start"; purpose: "engineer" | "learner" | "operator"; engine: "1" | "2"; profile: string | null; durationSeconds: number | null }
  | { capability: "load.recorded.accept"; bytes: number; rows: number; durationSeconds: number; scale: number }
  | { capability: "design.persist"; operation: "create" | "update"; countDelta: 0 | 1 }
  | { capability: "artifact.export"; artifactId: string; format: "html" | "json"; scope: "run" | "design" }
  | { capability: "run.control"; runId: string; control: string };
export interface CapabilitySubject { ownerId: string }
// Unknown usage is explicit. AllFreePolicy does not need a counting query.
export interface CapabilityUsage { activeRuns: number | null; savedDesigns: number | null }
export interface CapabilityDecision {
  allowed: boolean; revision: string; reason: string;
  allowance: { kind: "no-commercial-cap" } | { kind: "unavailable" };
}
export interface CapabilityPolicy {
  authorize(subject: CapabilitySubject, request: CapabilityRequest, usage: CapabilityUsage): CapabilityDecision;
}
const keys = new Set(["run.start", "load.recorded.accept", "design.persist", "artifact.export", "run.control"]);
export const AllFreePolicy: CapabilityPolicy = Object.freeze({
  authorize: () => ({ allowed: true, revision: "all-free/1", reason: "All supported capabilities are free.", allowance: { kind: "no-commercial-cap" as const } }),
});
export function authorizeCapability(subject: CapabilitySubject, request: CapabilityRequest,
  usage: CapabilityUsage = { activeRuns: null, savedDesigns: null }, provider: CapabilityPolicy = AllFreePolicy): CapabilityDecision {
  if (!subject.ownerId || !keys.has(request.capability)) return { allowed: false, revision: "all-free/1", reason: "Unknown capability or missing subject.", allowance: { kind: "unavailable" } };
  return provider.authorize(subject, request, usage);
}
export function requireCapability(ownerId: string, request: CapabilityRequest, provider: CapabilityPolicy = AllFreePolicy) {
  const decision = authorizeCapability({ ownerId }, request, undefined, provider);
  if (!decision.allowed) throw new AppError(decision.reason, 403);
  return decision;
}
// Startup consumes the recorded horizon, never a new admission or a plan lookup.
// A null horizon preserves existing open-ended runs; it is not a zero duration.
export function executionAllowance(durationSeconds: number | null) {
  if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) throw new AppError("Invalid recorded run horizon", 400);
  return { revision: "all-free/1", durationSeconds, allowance: { kind: "no-commercial-cap" as const } };
}
