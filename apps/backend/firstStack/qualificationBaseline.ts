import { z } from "zod";
import { hash } from "./canonical";
import { assertQualified, digestPattern, imagePattern, isolationPolicyHash, qualificationChecks, type HostQualification } from "./isolationPolicy";
import { inputDigest, readIsolatedCut, type IsolatedCut } from "./isolationProtocol";

// A rehearsal records durable evidence. Only a fresh live observation grants a
// short execution lease; the rehearsal itself never authorizes execution.
export const selfCheckIntervalMs = 5 * 60 * 1000;
export const selfCheckLeaseMs = 20 * 60 * 1000;
const baselineSchema = z.object({
  schema: z.literal("first-stack-baseline/2"), target: z.literal("ec2-c7i-flex.large"),
  image: z.string().regex(imagePattern), source: z.string().regex(digestPattern),
  daemon: z.string().regex(digestPattern), policy: z.literal(isolationPolicyHash),
  fingerprint: z.string().regex(digestPattern), canary: z.string().regex(digestPattern),
  checkedAt: z.iso.datetime(), capacity: z.literal(1), qualified: z.literal(true),
  checks: z.record(z.enum(qualificationChecks), z.literal(true)),
}).strict();
export type QualificationBaseline = z.infer<typeof baselineSchema>;
export function readQualificationBaseline(value: unknown,
  identity: { image: string; source: string; daemon: string }, fingerprint: string, now = Date.now()) {
  const baseline = baselineSchema.parse(value);
  if (Date.parse(baseline.checkedAt) > now || baseline.fingerprint !== fingerprint) {
    throw Error("Qualification fingerprint changed or observation is in the future");
  }
  // Reuse every existing identity, capacity and behavioral gate. This temporary
  // shape is validation only, never installed as execution authority.
  assertQualified(qualificationLease(baseline, now), identity, now);
  return baseline;
}
export function qualificationLease(baseline: QualificationBaseline, checkedAt: number): HostQualification {
  return { schema: "first-stack-host/1", target: baseline.target, image: baseline.image,
    source: baseline.source, daemon: baseline.daemon, policy: baseline.policy,
    capacity: baseline.capacity, qualified: baseline.qualified, checks: baseline.checks,
    checkedAt: new Date(checkedAt).toISOString(), expiresAt: new Date(checkedAt + selfCheckLeaseMs).toISOString() };
}
export function readQualificationCanary(value: unknown, baseline: QualificationBaseline) {
  const data = z.object({ input: z.string().max(1024 * 1024), expected: z.unknown() }).strict().parse(value);
  if (hash(data) !== baseline.canary) throw Error("Qualification canary changed");
  const expected = readIsolatedCut(data.expected as IsolatedCut, baseline.source, inputDigest(data.input));
  if (!expected.cut.completeness.horizonReached) throw Error("Canary must reach its authored horizon");
  return { input: data.input, expected };
}
