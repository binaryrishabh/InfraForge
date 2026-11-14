import {expect,test} from "bun:test";
import type {ChallengeStarter} from "@infraforge/contracts/challenges";
import {captureRunInputs} from "../deployments/runInputs";
import {challengeSeed} from "../challenges/registry";
import {createModel2Engine} from "../simulator/model2Engine";
import {reviewDesignChanges} from "../challenges/designChanges";
import {preflight} from "../challenges/preflight";
import {buildRunReport} from "../reports/report";
import {definition,REFERENCE,attemptRow,answers} from "./challengeHarness";

const d=definition("cache-an-empty-answer"),base=d.starter!,R=(s:ChallengeStarter,id:string)=>s.resources.find(r=>r.id===id)!;
const edit=(fn:(s:ChallengeStarter)=>void)=>{const s=structuredClone(base);fn(s);return s;};
const neg=(ttl:number)=>(s:ChallengeStarter)=>{R(s,"cache").cachePolicy!.negativeTtlSeconds=ttl;};
const both=(a:(s:ChallengeStarter)=>void,b:(s:ChallengeStarter)=>void)=>(s:ChallengeStarter)=>{a(s);b(s);};
const sweep:Record<string,(s:ChallengeStarter)=>void>={};
for(const ttl of [1,2,5,10,30,60,3600])sweep[`negative TTL ${ttl}`]=neg(ttl);
for(const ttl of [1,2,5,10,120,3600])sweep[`ordinary TTL ${ttl}`]=s=>{R(s,"cache").cachePolicy!.ttlSeconds=ttl;};
for(const cap of [1,16,1000])sweep[`capacity ${cap}`]=s=>{R(s,"cache").cachePolicy={...R(s,"cache").cachePolicy!,version:2,capacityEntries:cap};};
for(const cap of [1,4,8,16,24,32,64,1000])sweep[`negative capacity ${cap}`]=both(neg(30),s=>{R(s,"cache").cachePolicy={...R(s,"cache").cachePolicy!,version:2,capacityEntries:cap};});
for(const size of ["medium","large"] as const)sweep[`db ${size}`]=s=>{R(s,"db").size=size;};
for(const skuId of ["db.t3.micro","db.m5.large","db.m5.xlarge"])sweep[skuId]=s=>{R(s,"db").skuId=skuId;};
for(const skuId of ["c5.large","c5.xlarge","m5.xlarge"])sweep[`app ${skuId}`]=s=>{R(s,"app").skuId=skuId;};
for(const activeQueries of [1,2,4,32])sweep[`active ${activeQueries}`]=s=>{R(s,"db").dbConcurrency={version:1,activeQueries};};
for(const dbPoolMaxConnections of [1,4,64])sweep[`pool ${dbPoolMaxConnections}`]=s=>{R(s,"db").dbPoolMaxConnections=dbPoolMaxConnections;};
for(const count of [80,200,1000])sweep[`dataset ${count}`]=s=>{R(s,"db").dataKeyspace!.count=count;};
for(const absentCount of [0,20,100])sweep[`absent ${absentCount}`]=s=>{R(s,"db").dataKeyspace!.absentCount=absentCount;};
sweep["single-flight off"]=s=>{R(s,"cache").cachePolicy!.singleFlight=false;};
sweep["negative single-flight off"]=both(neg(30),sweep["single-flight off"]!);
sweep["negative ordinary TTL 1"]=both(neg(30),sweep["ordinary TTL 1"]!);
sweep["negative db large"]=both(neg(30),sweep["db large"]!);
sweep["hot-key"]=s=>{R(s,"db").dataKeyspace!.accessPattern="hot-key";};
sweep["negative hot-key"]=both(neg(30),sweep["hot-key"]!);

test("cache-an-empty-answer: every sweep edit is deployable before calibration",()=>{
 const input=captureRunInputs(base,d.workload,challengeSeed(d));
 for(const[name,fn]of Object.entries(sweep)){
  const design=edit(fn);expect(preflight(d,design).errors).toEqual([]);
  expect(reviewDesignChanges(input,captureRunInputs(design,d.workload,challengeSeed(d))).count).toBe(["negative db large","negative hot-key"].includes(name)?2:1);
 }
});

test("cache-an-empty-answer: sweep plausible saved edits and disclose all passing alternatives",()=>{
 expect(Object.keys(sweep).length).toBeGreaterThanOrEqual(40);
 const input=captureRunInputs(base,d.workload,challengeSeed(d)),table=[];
 for(const [name,fn]of Object.entries(sweep)){
  const design=edit(fn);expect(preflight(d,design).errors).toEqual([]);
  const review=reviewDesignChanges(input,captureRunInputs(design,d.workload,challengeSeed(d)));
  // Honest Compare groups an entire cachePolicy object as one field. Keep the scalar count separate so multi-control sweep edits are not presented as the reference's one scalar change.
  expect(review.count).toBe(["negative db large","negative hot-key"].includes(name)?2:1);
  const row=attemptRow(d,design,answers(d,{health:"saturated"})),report=buildRunReport(row),t=report.terminal!,c=t.resources.find(r=>r.id==="cache")!.cache!,w=t.traffic!.wholeRun!;
  const result={name,status:report.challenge!.status,completed:w.completed,failed:w.failed,absentAnswers:c.absentAnswers,negativeHits:c.negativeHits,source:c.absentSourceReads,ratio:c.absentAnswers?c.absentSourceReads!/c.absentAnswers:null,changes:review.count,scalarChanges:name.startsWith("negative ")&&!name.startsWith("negative TTL ")?2:1};table.push(result);console.info("negative-cache-sweep-row",JSON.stringify(result));
  if(name.startsWith("negative TTL ")||["negative single-flight off","negative ordinary TTL 1","negative db large","negative hot-key"].includes(name))expect(result.status).toBe("met");
  if(!name.startsWith("negative "))expect(result.status).toBe("not-met");
 }
 console.info("negative-cache-sweep",JSON.stringify({total:table.length,passing:table.filter(r=>r.status==="met").map(r=>r.name),table}));
},1200000);

test("cache-an-empty-answer: worst of five seeds has a comfortable caller and source-work margin",()=>{
 const near=edit(s=>{R(s,"cache").cachePolicy!.ttlSeconds=3600;}),table=[];
 for(const seed of [challengeSeed(d),"cx3-a","cx3-b","cx3-c","cx3-d"])for(const [name,design]of Object.entries({starter:base,reference:REFERENCE[d.id]!,near})){
  const m=createModel2Engine(captureRunInputs(design,d.workload,seed),12);for(let s=0;s<12;s++)m.advance();
  const v=m.view(),c=v.metrics.cache!.cache!,w=v.traffic!.wholeRun!,r={seed,name,completed:w.completed,failed:w.failed,ratio:c.absentSourceReads!/c.absentAnswers!,source:c.absentSourceReads};table.push(r);console.info("negative-cache-seed-row",JSON.stringify(r));
  if(name==="reference"){expect(r.completed-19000).toBeGreaterThan(2000);expect(r.failed).toBe(0);expect(.1-r.ratio).toBeGreaterThan(.09);}
  else{expect(r.failed-100).toBeGreaterThan(500);expect(r.ratio-.1).toBeGreaterThan(.5);}
 }
 for(const seed of new Set(table.map(r=>r.seed))){const a=table.find(r=>r.seed===seed&&r.name==="starter")!,b=table.find(r=>r.seed===seed&&r.name==="near")!;expect([a.completed,a.failed,a.ratio,a.source]).toEqual([b.completed,b.failed,b.ratio,b.source]);}
 console.info("negative-cache-seeds",JSON.stringify(table));
},600000);
