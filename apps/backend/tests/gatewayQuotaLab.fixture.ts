import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
let cached: ReturnType<typeof build> | undefined;
function build() {
  const d=definition("isolate-route-credits"),start=d.starter!,near=structuredClone(start);
  near.resources.find(r=>r.id==="writeApp")!.size="large";
  const designs=[start,REFERENCE[d.id]!,near],rows=designs.map(s=>attemptRow(d,s,answers(d,{"overall-health":"critical"})));
  return {d,designs,rows};
}
export function gatewayQuotaLabFixture(){return cached??=build();}
