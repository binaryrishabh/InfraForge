import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("set-the-limit-above-the-peak"), start = d.starter!, fixed = REFERENCE[d.id]!, burst = structuredClone(start);
  burst.resources.find(r => r.id === "lb")!.lbRateLimit!.burstRequests = 1000;
  const bigger = structuredClone(start), app = bigger.resources.find(r => r.id === "app")!;
  app.skuId = "c5.xlarge";
  const designs = [start, fixed, burst, bigger];
  const prediction = {...answers(d, {"overall-health": "critical"}), reasoning: "Thousands of callers are refused during the spike even though the app is idle, so I expect critical."};
  const rows = designs.map(s => attemptRow(d, s, prediction));
  rows[1]!.improvementSourceId = rows[0]!.id;
  rows[1]!.learningIntent = "improvement";
  rows[1]!.learningHypothesis = "Diagnosis: the balancer refills at 300 requests/s, so the 600/s spike is refused while the app has spare CPU. Raise only Sustained requests per second above the spike.";
  return {d, designs, rows};
}
export function rateLimitLabFixture() {return cached ??= build();}
