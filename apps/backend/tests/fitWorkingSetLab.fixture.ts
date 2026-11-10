import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("fit-the-working-set"), start = d.starter!, fixed = REFERENCE[d.id]!, near = structuredClone(start);
  const policy = near.resources.find(r => r.id === "cache")!.cachePolicy as {ttlSeconds?: number}; policy.ttlSeconds = 3600;
  const designs = [start, fixed, near];
  const prediction = {...answers(d, {"database-health": "degraded"}), reasoning: "Most reads miss and reach the database, so I expect it to be busy and degraded."};
  const rows = designs.map(s => attemptRow(d, s, prediction));
  rows[1]!.improvementSourceId = rows[0]!.id;
  rows[1]!.learningIntent = "improvement";
  rows[1]!.learningHypothesis = "Diagnosis: 16 entries cannot hold 256 keys, so evictions keep most reads missing and the database works. Raise only Logical cache capacity to 256 so reads can be reused.";
  return {d, designs, rows};
}
export function fitWorkingSetLabFixture() {return cached ??= build();}
