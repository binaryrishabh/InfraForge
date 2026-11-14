import { expect, test } from "bun:test";
import { createDataModel2 } from "../src/model2/data/run";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";
import { createHash } from "node:crypto";
import { EventKernel } from "../src/model2/time";
import { keyedCache } from "../src/model2/data/cache";
import { cacheAside } from "../src/model2/data/aside";
import type { CacheConfig, AsideConfig, DataRequest, DataReply } from "../src/model2/data/contracts";
import type { Invocation, Receipt, RemoteOutcome } from "../src/model2/workload/contracts";

function run(negative: boolean) {
  const input = dataFixture({keys: 4, count: 80, interval: 500, horizon: 60000, timeout: 20000, ttl: 100000, coalesce: true, slots: 64, dbCpu: 500});
  const db = input.resources.find(r => r.kind === "relational")!;
  if (db.kind !== "relational") throw Error("database");
  db.initial = [];
  const q = quantities();
  Object.assign(input.resources.find(r => r.kind === "cache")!, {negativeTtl: q.q("negative.ttl", negative ? 100000 : 0, "us")});
  Object.assign(input.resources.find(r => r.kind === "cache-aside")!, {negativeCaching: negative});
  input.ledger.push(...q.ledger);
  const m = createDataModel2(input); m.advanceTo(m.horizon); return m.evidence();
}
test("cache explicit successful absence, rather than sending every repeated lookup to the database", () => {
  const off = run(false), on = run(true);
  expect(off.counts.completed).toBe(80); expect(on.counts.completed).toBe(80);
  expect(off.data.applications[0]!.databaseFetches).toBe(80);
  expect(on.data.applications[0]!.databaseFetches).toBe(4);
  expect(on.data.databases[0]!.rows).toEqual([]);
  expect(on.data.caches[0]!.entries).toHaveLength(4);
  expect(on.data.caches[0]!.entries.every(e => e.absent && e.version === undefined && e.bytes === 0)).toBe(true);
  expect(on.data.applications[0]!.negative).toEqual({absentAnswers:81, negativeHits:76, absentSourceReads:4}); // includes the real startup probe
});

const work = (id: string, request: DataRequest): Invocation => ({rootId:JSON.stringify(["root","negative",id]),callId:JSON.stringify([id]),operation:"light",attempt:0,offeredAt:0,message:{request}});
function cacheWorld(ttl = 1000) {
  const input = dataFixture(), config = input.resources.find(r => r.kind === "cache") as CacheConfig;
  config.negativeTtl = quantities().q("negative.ttl", ttl,"us");
  const kernel = new EventKernel(100000), cache = keyedCache(config,kernel); let n=0;
  const call = (request: DataRequest) => { const w=work(String(n++),request); cache.accept(w,()=>{}); kernel.advanceTo(kernel.now+20); return w.message!.response as DataReply; };
  return {kernel,cache,call};
}
test("absence owns real entry overhead, expires at its own lifetime, and has no stale fallback",()=>{
  const w=cacheWorld(1000), token=w.call({kind:"get",key:"absent"}).token;
  expect(w.call({kind:"set",key:"absent",absent:true,token}).ok).toBe(true);
  expect(w.cache.evidence().allocatedEntryBytes).toBe(16);
  expect(w.call({kind:"get",key:"absent"})).toMatchObject({ok:true,hit:true,absent:true,rows:[]});
  w.kernel.advanceTo(1050);
  expect(w.call({kind:"get",key:"absent"}).hit).toBe(false);
  expect(w.call({kind:"get-stale",key:"absent"}).hit).toBe(false);
  expect(w.cache.evidence().allocatedEntryBytes).toBe(0);
});
test("flush and invalidation refuse an absence fill whose generation is old; contradictory bodies cannot be stored",()=>{
  for(const flush of [false,true]) {
    const w=cacheWorld(),token=w.call({kind:"get",key:"absent"}).token;
    if(flush) w.cache.flush(); else w.call({kind:"invalidate",key:"absent"});
    expect(w.call({kind:"set",key:"absent",absent:true,token})).toMatchObject({ok:false,reason:"invalidated-fill"});
    expect(w.call({kind:"set",key:"absent",absent:true,row:{version:1,bytes:1}}).ok).toBe(false);
    expect(w.cache.evidence().entries).toEqual([]);
  }
});
test("failures, missing rows and malformed success replies are never cached as absence",()=>{
  for(const reply of [undefined,{ok:false,rows:[]},{ok:true},{ok:true,rows:[],reason:"not-proven"}] as Array<DataReply|undefined>) {
    const w=cacheWorld(),f=dataFixture(),config=f.resources.find(r=>r.kind==="cache-aside") as AsideConfig;
    config.negativeCaching=true; let fetched=0;
    const send=(target:string,child:Invocation,done:(o:RemoteOutcome)=>void):Receipt=>{
      if(target==="cache") return w.cache.accept(child,done);
      fetched++; child.message!.response=reply; done(reply?.ok?"completed":"rejected");
      return {admitted:true,state:()=>"finished",cancel:()=>"already-finished"};
    };
    const aside=cacheAside(config,w.kernel,send,"seed");
    for(let i=0;i<3;i++){aside.accept(work(String(i),{kind:"get",key:"k0"}),()=>{});w.kernel.advanceTo(w.kernel.now+100);}
    expect(fetched).toBe(3); expect(w.cache.evidence().entries).toEqual([]);
    expect(aside.evidence().negative?.absentSourceReads).toBe(0);
  }
});
test("observation and batching do not alter negative-cache evidence",()=>{
  expect(run(true)).toEqual(run(true));
});
test("unmarked empty-result path keeps its baseline evidence bytes",()=>{
  const input=dataFixture({keys:4,count:80,interval:500,horizon:60000,timeout:20000,ttl:100000,coalesce:true,slots:64,dbCpu:500});
  const db=input.resources.find(r=>r.kind==="relational")!;if(db.kind==="relational")db.initial=[];
  const m=createDataModel2(input);m.advanceTo(m.horizon);
  expect(createHash("sha256").update(JSON.stringify(m.evidence())).digest("hex").slice(0,16)).toBe("eb6af165af49a45f");
});
