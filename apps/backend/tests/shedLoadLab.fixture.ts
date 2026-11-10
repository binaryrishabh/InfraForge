import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("shed-load-at-the-edge"), start = d.starter!, fixed = REFERENCE[d.id]!, near = structuredClone(start);
  near.resources.find(r => r.id === "app")!.size = "large";
  const designs = [start, fixed, near];
  const prediction = {...answers(d, {"overall-health": "critical"}), reasoning: "Most callers fail and the tail is long, so I expect critical."};
  const rows = designs.map(s => attemptRow(d, s, prediction));
  rows[1]!.improvementSourceId = rows[0]!.id;
  rows[1]!.learningIntent = "improvement";
  rows[1]!.learningHypothesis = "Diagnosis: the app is saturated and the balancer forwards nearly everything, so excess demand waits in the app and the final-second tail is long. Lower only Active requests so the excess is refused at the balancer.";
  return {d, designs, rows};
}
export function shedLoadLabFixture() {return cached ??= build();}
