import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("bound-replica-staleness"), start = d.starter!, fixed = REFERENCE[d.id]!, near = structuredClone(start);
  near.resources.find(r => r.id === "db")!.databaseReadRouting = {version: 1, policy: "primary-only"};
  const designs = [start, fixed, near];
  const prediction = {...answers(d, {"database-health": "healthy"}), reasoning: "Reads are fast and the writer is relieved, so the database looks healthy; stale reads are a separate measurement."};
  const rows = designs.map(s => attemptRow(d, s, prediction));
  rows[1]!.improvementSourceId = rows[0]!.id;
  rows[1]!.learningIntent = "improvement";
  rows[1]!.learningHypothesis = "Diagnosis: reads use the replica, which applies commits 1000 ms late, so many reads miss recent commits. Shorten only the modeled replication delay to cut stale reads while keeping reads off the writer.";
  return {d, designs, rows};
}
export function staleLabFixture() {return cached ??= build();}
