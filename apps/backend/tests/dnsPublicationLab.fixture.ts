import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
let cached: ReturnType<typeof build> | undefined;
function build() {
  const d=definition("resolve-after-publication"), start=d.starter!, near=structuredClone(start);
  near.resources.find(r=>r.id==="app")!.size="large";
  const designs=[start,REFERENCE[d.id]!,near],rows=designs.map(s=>attemptRow(d,s,answers(d,{"overall-health":"healthy"})));
  return {d,designs,rows};
}
export function dnsPublicationLabFixture(){return cached??=build();}
