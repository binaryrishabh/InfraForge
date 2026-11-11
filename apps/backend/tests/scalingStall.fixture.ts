import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("trace-a-scaling-stall"), start = d.starter!, fixed = REFERENCE[d.id]!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edit = (f: (app: any) => void) => { const s = structuredClone(start); f(s.resources.find(r => r.id === "app")!); return s; };
  const designs = [start, fixed,
    edit(a => {a.autoscaling.maxReplicas = 6;}),
    edit(a => {a.artifactCachePolicy.capacityBytes = 65536;}),
    edit(a => {a.size = "large";})];
  const prediction = {...answers(d, {health: "saturated", where: "app"}), reasoning: "The single app is saturated and callers fail."};
  const rows = designs.map(s => attemptRow(d, s, prediction));
  for (const i of [1, 2, 3, 4]) { rows[i]!.improvementSourceId = rows[0]!.id; rows[i]!.learningIntent = "improvement"; }
  rows[1]!.learningHypothesis = "Diagnosis: callers fail because the one app is saturated; the pool stays at one because the controller holds on measurements older than its freshness bound; they are old because the agent exports every twenty seconds. Shorten only Export interval.";
  return {d, designs, rows};
}
export function scalingStallFixture() {return cached ??= build();}
