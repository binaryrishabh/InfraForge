import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("keep-a-function-warm"), start = d.starter!, near = structuredClone(start);
  near.resources[0]!.serverless!.concurrency = 16;
  const designs = [start, REFERENCE[d.id]!, near], rows = designs.map(s => attemptRow(d, s, answers(d, {"overall-health": "healthy"})));
  return {d, designs, rows};
}
export function functionReuseLabFixture() {return cached ??= build();}
