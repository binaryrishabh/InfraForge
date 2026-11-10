import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
import { buildRunReport } from "../reports/report";
const d = definition("redrive-after-the-fix"), start = d.starter!, ref = REFERENCE[d.id]!;
const q=(s:any,f:(a:any)=>void)=>{const c=structuredClone(s);f(c.resources.find((r:any)=>r.id==="queue").asyncQueue);return c;};
for (const [n,s] of [["start",start],["ref",ref],["recv10",q(start,a=>a.maxReceives=10)],["redrive25",q(start,a=>a.redriveAtSecond=25)],["redrive31",q(start,a=>a.redriveAtSecond=31)]] as const){
  const r=buildRunReport(attemptRow(d,s as any,answers(d,{health:"healthy"}))); const t:any=r.terminal!.resources.find(x=>x.id==="queue");
  console.log(n,r.challenge!.status,JSON.stringify(r.challenge!.criteria.map((c:any)=>[c.status,c.detail])[1]), JSON.stringify(t.queueWork??t.asyncQueue ?? Object.keys(t)));
}
