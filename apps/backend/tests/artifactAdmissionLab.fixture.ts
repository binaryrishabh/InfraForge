import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
import { buildRunReport } from "../reports/report";

let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("admit-a-replica-image"), start = d.starter!, fixed = REFERENCE[d.id]!, near = structuredClone(start);
  near.resources.find(r => r.id === "app")!.autoscaling!.maxReplicas = 4;
  const designs = [start, fixed, near];
  const prediction = {...answers(d, {"overall-health": "healthy"}), reasoning: "The deployed app has CPU headroom; a blocked later replica need not make caller health unhealthy."};
  const rows = designs.map(s => attemptRow(d, s, prediction));
  rows[1]!.improvementSourceId = rows[0]!.id;
  rows[1]!.learningIntent = "improvement";
  rows[1]!.learningHypothesis = "Diagnosis: app#1/image refuses a 1024-byte layer with node-blob-cache-capacity in its 256-byte cache; no artifact or listener time is recorded. Increase only its saved byte capacity to admit the layer, then inspect listener readiness and LB health.";
  return {d, designs, rows};
}
export function artifactAdmissionLabFixture() {return cached ??= build();}
if (import.meta.main) console.log(JSON.stringify(artifactAdmissionLabFixture().rows.map(r => buildRunReport(r))));
