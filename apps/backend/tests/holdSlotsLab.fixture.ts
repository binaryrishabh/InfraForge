import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("hold-slots-on-a-slow-call"), start = d.starter!, fixed = REFERENCE[d.id]!, near = structuredClone(start);
  near.resources.find(r => r.id === "worker")!.size = "large";
  const designs = [start, fixed, near];
  const prediction = {...answers(d, {"overall-health": "degraded"}), reasoning: "Worker CPU is low but the backlog grows, so I expect degraded, not healthy."};
  const rows = designs.map(s => attemptRow(d, s, prediction));
  rows[1]!.improvementSourceId = rows[0]!.id;
  rows[1]!.learningIntent = "improvement";
  rows[1]!.learningHypothesis = "Diagnosis: worker CPU is low but one job at a time holds its slot for the 450 ms wait, so completion is about two a second against eight arriving. Increase only Jobs in parallel so more jobs wait at once.";
  return {d, designs, rows};
}
export function holdSlotsLabFixture() {return cached ??= build();}
