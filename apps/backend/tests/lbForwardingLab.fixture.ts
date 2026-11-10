import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
let cached: ReturnType<typeof build> | undefined;
function build() {
  const d = definition("open-the-forwarding-gate"), start = d.starter!, near = structuredClone(start);
  near.resources[0]!.lbAdmission!.maxQueued = 4096;
  const designs = [start, REFERENCE[d.id]!, near];
  const rows = designs.map(s => attemptRow(d, s, answers(d, {"busiest-type": "Virtual Machine"})));
  return {d, designs, rows};
}
export function lbForwardingLabFixture() {return cached ??= build();}
