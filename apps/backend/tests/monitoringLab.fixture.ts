import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";

export function labPolicy(design: Pick<ChallengeStarter, "resources">) {
  const policy = design.resources.find(r => r.id === "monitor")!.monitoringPolicy;
  if (policy?.version !== 2) throw Error("Expected the lab's saved buffer policy");
  return policy;
}

let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("move-monitoring-samples"), start = d.starter!, fixed = REFERENCE[d.id]!, near = structuredClone(start);
  labPolicy(near).bufferSamples = 256;
  const designs = [start, fixed, near];
  const rows = designs.map(s => attemptRow(d, s, answers(d, {"overall-health": "healthy"})));
  return {d, designs, rows};
}
export function monitoringLabFixture() { return cached ??= build(); }
