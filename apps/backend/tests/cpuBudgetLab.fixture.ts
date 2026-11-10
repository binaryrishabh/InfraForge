import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("release-the-cpu-budget"), start = d.starter!, near = structuredClone(start);
  near.resources[0]!.vmExecution!.workers = 64;
  const designs = [start, REFERENCE[d.id]!, near];
  const rows = designs.map(s => attemptRow(d, s, answers(d, {"overall-health": "critical"})));
  return {d, designs, rows};
}
export function cpuBudgetLabFixture() {return cached ??= build();}
