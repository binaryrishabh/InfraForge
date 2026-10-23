import { z } from "zod";
import { hash } from "../canonical";

const scoreSchema = z.object({ schema: z.literal("infraforge-server-score/1"),
  challenge: z.object({ id: z.string(), version: z.string() }), rubricVersion: z.string(),
  assessment: z.enum(["incomplete", "assessed"]), earned: z.number().int().nonnegative(), assessed: z.number().int().nonnegative(), pending: z.number().int().nonnegative(),
  systemPassed: z.boolean(), support: z.string(), workloads: z.array(z.object({ outcomes: z.array(z.object({ id: z.string(), required: z.boolean(),
    outcome: z.enum(["pass", "fail", "Unknown"]), reason: z.string().nullable(), support: z.enum(["supported-logical", "assumption-only", "Unknown"]) })) })) });
// No raw result, input, workload identity, cuts, rubric, journal, receipt or
// arbitrary exception text crosses this allowlist. It does not resolve a registry.
export function publicScore(result: any, resultHash: string | null) {
  if (!result || hash(result) !== resultHash || result.verification !== "verified") return null;
  if (result.score?.schema === "infraforge-scoring-unavailable/1" && result.score.state === "unavailable") {
    return { schema: "infraforge-scoring-unavailable/1" as const, state: "unavailable" as const, message: "Scoring unavailable" };
  }
  const parsed = scoreSchema.safeParse(result.score);
  if (!parsed.success) return null;
  const score = parsed.data, criteria = new Map<string, { id: string; required: boolean; outcome: "pass" | "fail" | "Unknown" }>();
  for (const workload of score.workloads) for (const criterion of workload.outcomes) {
    const previous = criteria.get(criterion.id);
    const outcome = criterion.outcome === "Unknown" || previous?.outcome === "Unknown" ? "Unknown" :
      criterion.outcome === "fail" || previous?.outcome === "fail" ? "fail" : "pass";
    criteria.set(criterion.id, { id: criterion.id, required: criterion.required, outcome });
  }
  return { schema: "infraforge-score-summary/1", challenge: score.challenge, rubricVersion: score.rubricVersion,
    assessment: score.assessment, earned: score.earned, assessed: score.assessed, pending: score.pending,
    systemPassed: score.systemPassed, support: score.support,
    criteria: [...criteria.values()].map(c => ({ ...c, reason: c.outcome === "Unknown" ? "Required server metric unavailable; no point awarded" : null })) };
}
