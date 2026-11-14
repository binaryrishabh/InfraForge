import {expect,test} from "bun:test";
import {mkdir,unlink,writeFile} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createModel2Run} from "@infraforge/simulation/model2-run";
import {buildContractFromRunInputs} from "@infraforge/simulation/internal-product";
import {validateInfrastructureName} from "@infraforge/domain/validation";
import type {ChallengeStarter} from "@infraforge/contracts/challenges";
import {captureRunInputs,readRunInputs} from "../deployments/runInputs";
import {createModel2Engine} from "../simulator/model2Engine";
import {challengeSeed,specHash} from "../challenges/registry";
import {buildRunReport} from "../reports/report";
import {reviewDesignChanges} from "../challenges/designChanges";
import {preflight} from "../challenges/preflight";
import {evaluateNegativeCache} from "../challenges/negativeCriterion";
import {definition,REFERENCE,answers,attemptRow} from "./challengeHarness";

const ID="cache-an-empty-answer",d=definition(ID),STARTER=d.starter!,REF=REFERENCE[ID]!,T=600000;
const edit=(fn:(s:ChallengeStarter)=>void,base=STARTER)=>{const s=structuredClone(base);fn(s);return s;};
const R=(s:ChallengeStarter,id:string)=>s.resources.find(r=>r.id===id)!;
const near=edit(s=>{R(s,"cache").cachePolicy!.ttlSeconds=3600;}),big=edit(s=>{R(s,"db").size="large";});
const run=(design:ChallengeStarter)=>{
 const row=attemptRow(d,design,answers(d,{health:"saturated"})),report=buildRunReport(row),t=report.terminal!,cache=t.resources.find(r=>r.id==="cache")!.cache!,w=t.traffic!.wholeRun!;
 return {row,report,status:report.challenge!.status,completed:w.completed,failed:w.failed,cache,ratio:cache.absentSourceReads!/cache.absentAnswers!};
};
const measured=new Map<ChallengeStarter,ReturnType<typeof run>>();
const resultFor=(design:ChallengeStarter)=>{if(!measured.has(design))measured.set(design,run(design));return measured.get(design)!;};
const results=()=>[STARTER,REF,near,big].map(resultFor);

test("cache-an-empty-answer: a stored absence avoids repeated real queries, with caller harm, a TTL near miss and a separate capacity improvement",()=>{
 expect(validateInfrastructureName(d.title)).toBeNull();expect(specHash(d)).toBe(new RegExp(`"${ID}@1": "([a-f0-9]{64})"`).exec(readFileSync(new URL("./challengeAuthoring.test.ts",import.meta.url),"utf8"))![1]!);
 const designs=[STARTER,REF,near,big],inputs=designs.map(s=>captureRunInputs(s,d.workload,challengeSeed(d)));
 for(const s of designs)expect(preflight(d,s).errors).toEqual([]);
 for(const i of inputs)expect(i.adapterProfiles).toContain("cache-negative/1");
 expect(REF).toEqual(edit(s=>{R(s,"cache").cachePolicy!.negativeTtlSeconds=30;})); // exactly one saved scalar, independent of Compare's object grouping
 for(const i of inputs.slice(1))expect(i.adapterProfiles).toEqual(inputs[0]!.adapterProfiles);
 for(const i of inputs.slice(1))expect(reviewDesignChanges(inputs[0]!,i)).toMatchObject({classification:"one-change",count:1});
 const r=results();expect(r.map(x=>x.status)).toEqual(["not-met","met","not-met","not-met"]);
 expect(r[0]!.report.challenge!.predictions[0]).toMatchObject({actual:"saturated",outcome:"matched"});
 expect(r[1]!.report.challenge!.predictions[0]).toMatchObject({actual:"healthy",outcome:"different"});
 expect(r.map(x=>[x.completed,x.failed,x.cache.absentAnswers,x.cache.negativeHits,x.cache.absentSourceReads])).toEqual([
  [20074,1399,16155,0,11970],[21743,0,17492,17386,80],[20074,1399,16155,0,11970],[21739,0,17488,0,17127],
 ]);
 expect(r[1]!.completed-19000).toBeGreaterThan(2500);expect(0.1-r[1]!.ratio).toBeGreaterThan(0.09);expect(r[0]!.ratio-0.1).toBeGreaterThan(0.6);
 expect(r[0]!.report.terminal!.resources.find(x=>x.id==="db")!.cpu).toBe(100);
 expect(r[3]!.report.challenge!.criteria.map(x=>x.status)).toEqual(["met","met","not-met"]); // larger source fixes capacity but repeats empty queries
 for(const x of r){const saved={...x.row,runInputs:JSON.parse(JSON.stringify(x.row.runInputs)),terminalSnapshot:JSON.parse(JSON.stringify(x.row.terminalSnapshot))};expect(buildRunReport(saved).terminal).toEqual(x.report.terminal);expect(buildRunReport(saved).challenge).toEqual(x.report.challenge);}
 console.info("cache-an-empty-answer-calibration",JSON.stringify(r.map(x=>({status:x.status,completed:x.completed,failed:x.failed,cache:x.cache,ratio:x.ratio}))));
},T);

test("cache-an-empty-answer: missing, malformed, zero-demand and contradictory saved evidence never passes",()=>{
 const x=resultFor(REF),criterion=d.criteria.find(c=>c.kind==="cache-negative-load")!;
 if(criterion.kind!=="cache-negative-load")throw Error("criterion");
 const input=captureRunInputs(REF,d.workload,challengeSeed(d)),terminal=x.report.terminal!;
 const verdict=(patch:(c:Record<string,unknown>)=>void)=>{
  const saved=structuredClone(x.row.terminalSnapshot) as {metrics:Record<string,{cache:Record<string,unknown>}>};patch(saved.metrics.cache!.cache);
  return buildRunReport({...x.row,terminalSnapshot:saved as never}).challenge!.criteria[2]!.status;
 };
 expect(verdict(()=>{})).toBe("met");
 for(const key of ["absentAnswers","negativeHits","absentSourceReads"]){
  expect(verdict(c=>{delete c[key];})).toBe("not-evaluated");
  for(const value of [null,-1,1.5,Number.MAX_SAFE_INTEGER+1,"0"])expect(verdict(c=>{c[key]=value;})).toBe("not-evaluated");
 }
 expect(verdict(c=>{c.negativeHits=(c.absentAnswers as number)+1;})).toBe("not-evaluated");
 expect(verdict(c=>{c.hits=0;})).toBe("not-evaluated");
  expect(verdict(c=>{c.absentSourceReads=0;})).toBe("not-evaluated");
  expect(verdict(c=>{c.negativeHits=0;c.coalescedWaiters=0;})).toBe("not-evaluated");
  expect(verdict(c=>{c.coalescedWaiters=null;})).toBe("not-evaluated");
 expect(verdict(c=>{c.absentAnswers=0;c.negativeHits=0;c.absentSourceReads=0;})).toBe("not-met");
 expect(verdict(c=>{c.absentSourceReads=c.absentAnswers;})).toBe("not-met");
 const evalDirect=(t=terminal,i:typeof input|null=input,active=false,profiles:readonly string[]|undefined=input.adapterProfiles)=>evaluateNegativeCache(criterion,i,t,12,active,profiles);
 expect(evalDirect().met).toBe(true);expect(evalDirect(terminal,input,true).met).toBeUndefined();expect(evalDirect(terminal,null).met).toBeUndefined();
 expect(evalDirect({...terminal,simulatedSeconds:11}).met).toBeUndefined();expect(evalDirect({...terminal,measurementFreshness:"stale-revision" as never}).met).toBeUndefined();
 expect(evalDirect(terminal,input,false,[]).met).toBeUndefined();
 expect(evaluateNegativeCache(criterion,input,null,12,false,input.adapterProfiles).met).toBeUndefined();
 const stale={...structuredClone(x.row.terminalSnapshot) as object,metricsTopologyRevision:1};
 expect(buildRunReport({...x.row,terminalSnapshot:stale}).challenge!.criteria[2]!.status).toBe("not-evaluated");
 const changed=structuredClone(input);changed.resources.find(r=>r.id==="cache")!.cachePolicy!.negativeTtlSeconds=0;
 expect(buildRunReport({...x.row,liveTopology:{resources:changed.resources,connectionLines:changed.connectionLines}}).challenge!.criteria[2]!.status).toBe("not-evaluated");
 const unmarked=structuredClone(input);delete unmarked.resources.find(r=>r.id==="cache")!.cachePolicy!.negativeTtlSeconds;expect(evalDirect(terminal,unmarked).met).toBeUndefined();
 const dropped=structuredClone(input);dropped.resources=dropped.resources.filter(r=>r.id!=="cache");expect(evalDirect(terminal,dropped).met).toBeUndefined();
},T);

test("cache-an-empty-answer: lesson, module, vocabulary and unchanged reviewed identity are registered",async()=>{
 const {findLearningLesson,LEARNING_REGISTRY}=await import("../learning/registry"),{learningContent}=await import("../learning/content"),{validateLearningContent}=await import("../learning/validate");
 const {checkLessonClaims}=await import("../learning/claims"),{REVIEWED_CHALLENGES}=await import("../learning/reviewedChallenges");
 const l=findLearningLesson(ID)!;expect(l).toMatchObject({kind:"executable-lab",trackId:"data",moduleId:"cache-absence",experiment:{challengeId:ID},check:null});
 expect(l.contentVersion).toBeGreaterThanOrEqual(1);
 expect(LEARNING_REGISTRY.findModule("data","cache-absence")!.lessonIds).toEqual([ID]);expect(REVIEWED_CHALLENGES[`${ID}@${l.contentVersion}`]).toEqual({challengeId:ID,version:d.version,hash:specHash(d)});
 expect(validateLearningContent(learningContent)).toEqual([]);expect(checkLessonClaims(l,d)).toEqual([]);
 expect(l.limitations.join(" ")).toContain("no inserts");expect(l.explanation.join(" ")).toContain("valid capacity improvement");
});

test("cache-an-empty-answer: browser-target bundle, JSON capture and two server replays agree each second",async()=>{
 const entry=resolve(import.meta.dir,`../../../.cache/cache-negative-${process.pid}.ts`),out=entry.replace(/\.ts$/,".mjs");await mkdir(dirname(entry),{recursive:true});
 try{
  await writeFile(entry,'export {createModel2Run} from "../packages/simulation/src/model2Run";\nexport {buildContractFromRunInputs} from "../packages/simulation/src/model2/product/runContract";\n',"utf8");
  const p=Bun.spawn([process.execPath,"--no-env-file","build",entry,"--target=browser","--outfile",out],{stdout:"ignore",stderr:"pipe"});const diagnostic=await new Response(p.stderr).text();if(await p.exited!==0)throw Error(diagnostic);
  const browser=await import(pathToFileURL(out).href) as {createModel2Run:typeof createModel2Run;buildContractFromRunInputs:typeof buildContractFromRunInputs};
  for(const design of [STARTER,REF,near]){
   const input=readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design,d.workload,challengeSeed(d)))));
   expect(browser.buildContractFromRunInputs(input,12)).toEqual(buildContractFromRunInputs(input,12));
   const a=browser.createModel2Run(input,12),b=createModel2Engine(input,12),c=createModel2Engine(input,12);
   for(let s=1;s<=12;s++){a.advance();b.advance();c.advance();expect(a.view()).toEqual(b.view());expect(a.evidence()).toEqual(b.evidence());expect(c.evidence()).toEqual(b.evidence());}
  }
 }finally{for(const path of [entry,out])if(await Bun.file(path).exists())await unlink(path);}
},T);

test("cache-an-empty-answer: the lesson states the visibility cost of caching absence that this static dataset cannot show and names the DNS lab that shows it",async()=>{
 const {findLearningLesson}=await import("../learning/registry"),{checkLessonClaims}=await import("../learning/claims"),{validateLearningContent}=await import("../learning/validate"),{learningContent}=await import("../learning/content");
 const l=findLearningLesson(ID)!,dns=findLearningLesson("resolve-after-publication")!;
 expect(dns).toBeDefined();expect(l.limitations.join(" ")).toContain(dns.title);expect(l.limitations.join(" ")).toMatch(/published later|new(?:ly created)? row/i);
 expect(validateLearningContent(learningContent)).toEqual([]);expect(checkLessonClaims(l,d)).toEqual([]);
});
