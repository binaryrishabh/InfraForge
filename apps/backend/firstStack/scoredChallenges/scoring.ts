import { z } from "zod";
import { hash } from "../canonical";
import { inputDigest, readIsolatedCut, type IsolatedCut } from "../isolationProtocol";
import type { ChallengeDefinition, ChallengeWorkload } from "./definition";

const tail = z.discriminatedUnion("kind", [z.object({ kind: z.literal("exact"), p: z.number(), valueUs: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("bounded"), p: z.number(), minUs: z.number().nonnegative(), maxUs: z.number().nonnegative() }),
  z.object({ kind: z.literal("unknown"), p: z.number(), reason: z.string() })]);
const distributions = z.object({ censored: z.number().int().nonnegative(), groups: z.array(z.object({ operation: z.string(),
  outcome: z.enum(["completed", "rejected", "deadline-exceeded", "abandoned"]), count: z.number().int().positive(), percentiles: z.array(tail) })) });
export interface CriterionOutcome { id: string; required: boolean; outcome: "pass" | "fail" | "Unknown"; measured: number | null; reason: string | null; support: "supported-logical" | "assumption-only" | "Unknown" }
export function evaluateWorkload(definition: ChallengeDefinition, workload: ChallengeWorkload, input: string, cut: IsolatedCut | null): CriterionOutcome[] {
  let reason: string | null = null, evidence: z.infer<typeof distributions> | null = null;
  const recording = JSON.parse(input).recording;
  try {
    if (!cut) throw Error("Server execution has no durable evidence");
    readIsolatedCut(cut, cut.source, inputDigest(input));
    if (!cut.cut.completeness.horizonReached || !cut.cut.completeness.allRootsTerminal || !cut.cut.timestampComplete || cut.cut.interruption) throw Error("Server execution or caller population incomplete");
    const rows = recording.rows as { atUs: number }[];
    if (!rows.length || rows.some(r => r.atUs < workload.observation.fromUs || r.atUs >= workload.observation.toUs) ||
      rows.length !== workload.rows.length || cut.cut.counts.offered !== rows.length) throw Error("Observation cohort coverage unavailable");
    evidence = distributions.parse(cut.cut.distributions);
    const terminal = evidence.groups.reduce((n, g) => n + g.count, 0);
    if (evidence.censored || terminal !== rows.length || cut.cut.unfinished.callers || cut.cut.unfinished.notYetOffered) throw Error("Caller population conservation unavailable");
    for (const [outcome, key] of [["completed", "completed"], ["rejected", "rejected"], ["deadline-exceeded", "deadlineExceeded"], ["abandoned", "abandoned"]]) {
      if (cut.cut.counts[key!] !== evidence.groups.filter(g => g.outcome === outcome).reduce((n, g) => n + g.count, 0)) throw Error("Caller outcomes disagree with aggregate counts");
    }
  } catch (error) { reason = error instanceof Error ? error.message : "Server evidence unavailable"; evidence = null; }
  return definition.rubric.criteria.map(criterion => {
    let measured: number | null = null, unknown = reason, support: CriterionOutcome["support"] = "supported-logical";
    if (criterion.metric === "cost-subtotal") { unknown = "Supported cost subtotal unavailable in this engine/profile revision; full cost is Unknown"; support = "Unknown"; }
    else if (evidence && cut) {
      const completed = cut.cut.counts.completed!, offered = cut.cut.counts.offered!;
      if (criterion.metric === "delivery-permille") measured = completed * 1000 / offered;
      if (criterion.metric === "error-permille") measured = (offered - completed) * 1000 / offered;
      if (criterion.metric === "fault-delivery-permille") {
        const fault = workload.faults.find(f => f.kind === "app-process-crash");
        if (!fault || fault.kind !== "app-process-crash" || workload.observation.fromUs < fault.atUs ||
          workload.observation.toUs > fault.atUs + fault.downtimeUs) unknown = "Observation cohort is not wholly inside the declared app outage";
        else measured = completed * 1000 / offered; // Routed foreground caller outcomes, never a health label.
      }
      if (criterion.metric === "p95-us") {
        support = "assumption-only";
        const groups = evidence.groups.filter(g => g.outcome === "completed");
        const p95 = groups[0]?.percentiles.find(p => p.p === 0.95);
        if (groups.length !== 1 || groups[0]!.count < 20 || p95?.kind !== "exact") unknown = "At least 20 completed callers and an exact single-operation p95 are required";
        else measured = p95.valueUs;
      }
    }
    if (measured === null || criterion.threshold === null) return { id: criterion.id, required: criterion.required, outcome: "Unknown", measured: null, reason: unknown ?? "Required metric unavailable", support: "Unknown" };
    return { id: criterion.id, required: criterion.required, measured, reason: null, support,
      outcome: (criterion.operator === "gte" ? measured >= criterion.threshold : measured <= criterion.threshold) ? "pass" : "fail" };
  });
}
export function scoreRecord(definition: ChallengeDefinition, run: any, workloads: { reference: ChallengeWorkload; input: string; evidence: IsolatedCut | null; receipt: unknown; outcomes: CriterionOutcome[] }[]) {
  const outcomes = workloads.flatMap(w => w.outcomes), pending = outcomes.filter(c => c.outcome === "Unknown").length;
  return { schema: "infraforge-server-score/1", challenge: { id: definition.id, version: definition.version, definitionHash: hash(definition) },
    rubricVersion: definition.rubric.version, rubric: structuredClone(definition.rubric), engine: run.engine, design: { lineage: run.lineage, visibleInputHash: run.inputHash },
    // This complete audit record is server-only and covered by FirstStackResult's
    // existing append-only trigger and hash. Client projections omit it entirely.
    workloads: workloads.map(w => ({ workload: { id: w.reference.id, version: w.reference.version, hash: hash(w.reference) },
      input: w.input, inputHash: inputDigest(w.input), evidence: w.evidence, receipt: w.receipt, outcomes: w.outcomes })),
    assessment: pending ? "incomplete" : "assessed", earned: outcomes.filter(c => c.outcome === "pass").length,
    assessed: outcomes.length - pending, pending,
    systemPassed: workloads.length === definition.hidden.length && outcomes.some(c => c.required) && outcomes.filter(c => c.required).every(c => c.outcome === "pass"),
    support: "conditional logical exercise; timing assumption-only; no certificate or readiness claim" };
}
