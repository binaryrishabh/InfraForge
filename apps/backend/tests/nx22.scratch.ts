import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";
import { buildRunReport } from "../reports/report";
const d = definition("trace-a-slowdown-cascade"), start = d.starter!;
const mod=(f:(s:any)=>void)=>{const c=structuredClone(start);f(c);return c;};
const R=(s:any,id:string)=>s.resources.find((r:any)=>r.id===id);
const variants:[string,any][]=[["start",start],["ref(singleflight)",REFERENCE[d.id]],["bigapp",mod(s=>{R(s,"app").skuId="m5.2xlarge";})],["bigdb",mod(s=>{delete R(s,"db").size; R(s,"db").skuId="db.m5.2xlarge";})],["noretry",mod(s=>{R(s,"lb").retry.maxAttempts=1;})],["ttl10",mod(s=>{R(s,"cache").cachePolicy.ttlSeconds=10;})]];
for (const [n,s] of variants){
  let r:any; try { r=buildRunReport(attemptRow(d,s,answers(d,{health:"healthy",database:"healthy"}))); } catch(e:any){ console.log(n,"ERR",e.message.slice(0,80)); continue; } console.log(n,r.challenge!.status,r.challenge!.criteria.slice(1).map((c:any)=>c.status+": "+c.detail.slice(0,150)).join(" | "));
}
