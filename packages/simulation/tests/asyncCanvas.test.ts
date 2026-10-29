import { test, expect } from 'bun:test';
import { design, prepare, hash } from './asyncCanvas.fixture';
import { createProductModel2 } from '../src/model2/product/run';
import { contractFromDesign } from '../src/model2/product/fromDesign';
test('existing queue contract, compiled input, assumptions and evidence retain pinned bytes',()=>{
 const a=prepare(design(false));const r=createProductModel2(a.compiled);r.advanceTo(10000000);
 expect({contract:hash(a.contract),compiled:hash(a.compiled),assumptions:hash(a.assumptions),evidence:hash(r.evidence())}).toEqual({contract:'7f91fddd4dd760a224607471d6ca343c22dfccc7f328e2dc6d9e700400b177ca',compiled:'24dff1955f8880e7553364bdac45086a58a541b51bb473bfdd8303723e5e946b',assumptions:'a34ebfbdb61243f406ebc7e95c39274e2994fddaba4eb4786164abf887d67dc2',evidence:'c3c014add9ab8b4b7ba78f2a78fe9d83501dda0ed4811394afad79da0137032e'});
});
test('canvas binds one publish to each served arrival and worker reads, writes and acknowledges',()=>{
 const a=prepare(design(true,1));const r=createProductModel2(a.compiled);r.advanceTo(10000000);const e=r.evidence();
 expect(e.asynchronous.brokers[0]!.accepted).toBe(10);
 expect(e.asynchronous.workers[0]!.acknowledged).toBe(10);
 expect(e.asynchronous.publishers[0]!.uploaded).toBe(10);
 expect(e.asynchronous.workers[0]!.effects).toBe(10);
 expect(e).toEqual((()=>{const b=createProductModel2(a.compiled);b.advanceTo(10000000);return b.evidence();})());
});
test('missing storage and incomplete authored settings are refused clearly',()=>{
 const d=design();d.connections=d.connections.filter(e=>e.targetId!=='store');
 const a=contractFromDesign(d);expect('refused' in a && a.refused.some(r=>r.message.includes('Object Storage'))).toBe(true);
 const b=design();b.resources.find(r=>r.id==='worker')!.asyncWorker!.prefetch=undefined;
 expect('refused' in contractFromDesign(b)).toBe(true);
});
import { withRunLength } from '../src/model2/product/runContract';
import { withTimeline } from '../src/model2/product/timeline';
import { compileProduct } from '../src/model2/product/compiler';
import { createLiveModel2 } from '../src/model2/product/live';

function journey(name: 'control' | 'overload' | 'recovery' | 'lease', credit = 1, concurrency = 1) {
 const d=design(true,name==='control'?1:name==='lease'?2:8);
 const worker=d.resources.find(r=>r.id==='worker')!.asyncWorker!;
 worker.prefetch=credit;worker.concurrency=concurrency;
 if(name==='lease') {worker.cpuMsPerJob=1500;d.resources.find(r=>r.id==='queue')!.asyncQueue!.visibilityTimeoutSeconds=1;}
 const a=prepare(d);let contract=withRunLength(a.contract,35,'async-proof');
 if(name==='recovery') contract=withTimeline(contract,[{id:'drop',kind:'load',atUs:10000001,fraction:0.125}]);
 const c=compileProduct(d,contract);if(!c.ok)throw Error(JSON.stringify(c));
 const r=createProductModel2(c.value);
 const rows=[]; let maxReadyAgeUs=0;
 for(let t=10000;t<=35000000;t+=10000) {
  r.advanceTo(t);const q=r.inspectQueue('queue')!,w=r.inspectWorker('worker')!;maxReadyAgeUs=Math.max(maxReadyAgeUs,q.oldestReadyAgeUs??0);
  expect(q.inFlight).toBeLessThanOrEqual(credit);expect(w.creditOwnedLocally).toBeLessThanOrEqual(credit);expect(w.active).toBeLessThanOrEqual(concurrency);
  if(t%1000000===0)rows.push({second:t/1000000,...q,...w});
 }
 return {rows,maxReadyAgeUs,evidence:r.evidence(),compiled:c.value};
}

test('below-capacity control has near-zero backlog, small age and matched accepted/finished',()=>{
 const a=journey('control');expect(a.maxReadyAgeUs).toBeLessThan(20000);
 expect(a.rows.every(r=>r.ready===0 && r.oldestReadyAgeUs===null)).toBe(true);
 expect(a.rows.at(-1)).toMatchObject({accepted:35,processed:35,inFlight:0,redelivered:0,deadLettered:0});
});
test('overload grows real ready depth and oldest-ready age monotonically while producers continue',()=>{
 const a=journey('overload');
 for(let i=1;i<a.rows.length;i++) {expect(a.rows[i]!.ready).toBeGreaterThanOrEqual(a.rows[i-1]!.ready);expect(a.rows[i]!.oldestReadyAgeUs!).toBeGreaterThan(a.rows[i-1]!.oldestReadyAgeUs!);expect(a.rows[i]!.accepted).toBeGreaterThan(a.rows[i]!.processed);}
 expect(a.rows[9]).toMatchObject({accepted:80,processed:38,ready:41,inFlight:1,oldestReadyAgeUs:5121246});
 expect(a.rows.at(-1)).toMatchObject({accepted:280,processed:134,ready:145});
});
test('lowering load drains the real backlog at its net service rate, with exact replay',()=>{
 const a=journey('recovery'),b=journey('recovery');expect(a.evidence).toEqual(b.evidence);expect(a.rows).toEqual(b.rows);
 const start=a.rows[9]!,empty=a.rows.find(r=>r.second>10 && r.ready===0)!;
 expect(start).toMatchObject({ready:41,inFlight:1,processed:38});expect(empty.second).toBe(25);
 const capacity=38/10,arrival=1,predicted=(start.ready+start.inFlight)/(capacity-arrival);
 expect(Math.abs(empty.second-10-predicted)).toBeLessThanOrEqual(1);
 expect(a.rows[24]).toMatchObject({accepted:96,processed:96,ready:0,inFlight:0,oldestReadyAgeUs:null});
 const live=createLiveModel2(a.compiled,['app','queue','worker','store']);
 for(let s=1;s<=35;s++){live.advanceSecond();const p=live.project();if(s===10)expect(p.metrics.queue!.health).toBe('degraded');if(s===35){expect(p.metrics.queue!.health).toBe('healthy');expect(p.metrics.queue!.asyncQueue).toMatchObject({published:106,completed:106,readyDepth:0,oldestReadyAgeSeconds:null});}}
});
test('prefetch bounds leased jobs while concurrency separately bounds active CPU jobs',()=>{
 const a=journey('overload',4,2);
 expect(a.rows.some(r=>r.creditOwnedLocally===4)).toBe(true);
 expect(a.rows.some(r=>r.active===2)).toBe(true);
});
test('a long job visibly expires its lease and is delivered again, with stale ack and duplicate effect risk',()=>{
 const a=journey('lease');const q=a.evidence.asynchronous.brokers[0]!,w=a.evidence.asynchronous.workers[0]!;
 expect(q.redelivered).toBe(6);expect(q.leaseExpired).toBeGreaterThan(0);expect(q.staleReceipts).toBeGreaterThan(0);
 expect(w.ackFailed).toBeGreaterThan(0);expect(q.deadLettered).toBe(1);expect(w.effects).toBe(23);expect(w.acknowledged).toBe(0);
 expect(new Set(w.events.filter(e=>e.kind==='object-effect').map(e=>e.message)).size).toBeLessThan(w.effects);
});

test('authored queue and worker values retain saved-field provenance and disabled settings retain legacy bytes',()=>{
 const d=design(),a=prepare(d);
 for(const key of ['visibilityTimeoutSeconds','maxReceives','retentionSeconds'])expect(a.compiled.semantic.numericOrigins.some(r=>r.origin==='user-authored' && r.sources.includes(`saved-design:queue.asyncQueue.${key}`))).toBe(true);
 for(const key of ['concurrency','prefetch','cpuMsPerJob'])expect(a.compiled.semantic.numericOrigins.some(r=>r.origin==='user-authored' && r.sources.includes(`saved-design:worker.asyncWorker.${key}`))).toBe(true);
 const old=design(false),before=prepare(old);old.resources.find(r=>r.id==='queue')!.asyncQueue={enabled:false};expect(prepare(old)).toEqual(before);
});

test('producer behind load balancer is refused so health polling cannot publish uploads',()=>{
 const d=design();d.resources.push({id:'lb',type:'Load Balancer',x:0,y:0});d.connections.push({id:'lb-app',sourceId:'lb',targetId:'app',sourceType:'Load Balancer',targetType:'Virtual Machine',port:80});
 const a=contractFromDesign(d);expect('refused' in a && a.refused.some(r=>r.message.includes('health polling'))).toBe(true);
});
