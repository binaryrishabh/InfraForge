import { test, expect } from 'bun:test';
import { design, prepare, hash } from './asyncCanvas.fixture';
import { contractFromDesign } from '../src/model2/product/fromDesign';
import { compileProduct } from '../src/model2/product/compiler';
import { withRunLength } from '../src/model2/product/runContract';
import { createProductModel2 } from '../src/model2/product/run';

function compile(share?: number) {
 const d=design(true,3.5);if(share!==undefined)d.resources.find(r=>r.id==='worker')!.asyncWorker!.badJobPercent=share;
 const a=prepare(d),c=compileProduct(d,withRunLength(a.contract,35,'async-proof'));if(!c.ok)throw Error(JSON.stringify(c));
 return {d,a,compiled:c.value};
}

test('absent poison settings retain pre-edit slice 1 bytes and explicit zero changes only authored provenance',()=>{
 const old=compile(),zero=compile(0);
 const run=(c:typeof old.compiled)=>{const r=createProductModel2(c);r.advanceTo(35000000);return r.evidence();};
 expect({contract:hash(old.a.contract),compiled:hash(old.compiled),assumptions:hash(old.a.assumptions),evidence:hash(run(old.compiled))}).toEqual({contract:'ebb8d4e2ecc8fd8e2fe26dc90829ecceb36db3f6e6a278550a17718294ae2aad',compiled:'aa036942b9ce49c1b50c92f852757301c7a73496b8aaa57d1715d95cbe450102',assumptions:'fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03',evidence:'140a1de603d9fac509eb07ae419959cac6fbb438d5b38538a0365ced828ddab5'});
 const baseline=run(old.compiled),explicit=run(zero.compiled);
 expect(explicit.provenance.ledger.filter(r=>r.id==='worker.asyncWorker.badJobPercent')).toHaveLength(1);
 expect({...explicit,provenance:{...explicit.provenance,ledger:explicit.provenance.ledger.filter(r=>r.id!=='worker.asyncWorker.badJobPercent')}}).toEqual(baseline);
});

test('poison share selects bounded publisher root keys deterministically from seed and identity',()=>{
 const a=compile(10),b=compile(10),low=compile(5),all=compile(100);
 const keys=(c:typeof a)=>{const w=c.compiled.input.resources.find(r=>r.kind==='async-worker')!;if(w.kind!=='async-worker')throw Error();return w.poisonKeys;};
 expect(keys(a).length).toBeGreaterThan(0);expect(keys(a)).toEqual(keys(b));expect(keys(low).every(k=>keys(a).includes(k))).toBe(true);expect(keys(all)).toHaveLength(123);
 expect(keys(a).every(k=>JSON.parse(k)[0]==='root')).toBe(true);
 expect(a.a.contract.ledger.find(r=>r.id==='worker.asyncWorker.badJobPercent')!.provenance[0]!.source).toBe('saved-design:worker.asyncWorker.badJobPercent');
 const changed=compileProduct(a.d,withRunLength(a.a.contract,35,'other-seed'));expect(changed.ok).toBe(true);if(changed.ok)expect(changed.value.input.resources.find(r=>r.kind==='async-worker')).not.toEqual(a.compiled.input.resources.find(r=>r.kind==='async-worker'));
});

test('optional poison settings validate without injecting into earlier designs and retain DLQ provenance',()=>{
 for(const share of [-1,101,0.5,NaN,Infinity]) {const d=design();d.resources.find(r=>r.id==='worker')!.asyncWorker!.badJobPercent=share;expect('refused' in contractFromDesign(d)).toBe(true);}
 for(const capacity of [-1,1001,1.5,NaN]) {const d=design();d.resources.find(r=>r.id==='queue')!.asyncQueue!.deadLetterCapacity=capacity;expect('refused' in contractFromDesign(d)).toBe(true);}
 const d=design();d.resources.find(r=>r.id==='queue')!.asyncQueue!.deadLetterCapacity=0;
 expect(prepare(d).compiled.semantic.numericOrigins.some(r=>r.origin==='user-authored' && r.sources.includes('saved-design:queue.asyncQueue.deadLetterCapacity'))).toBe(true);
 const a=compile(10);a.a.contract.nodes.worker!.asyncBadJobPercent=undefined;expect(compileProduct(a.d,a.a.contract).ok).toBe(false);
});

import { withTimeline } from '../src/model2/product/timeline';
import { createLiveModel2 } from '../src/model2/product/live';

function poisonJourney(share: number, capacity = 1000, parallel = 1, burst = false) {
 const d=design(true,3.5),worker=d.resources.find(r=>r.id==='worker')!;
 worker.asyncWorker!.badJobPercent=share;worker.asyncWorker!.concurrency=parallel;worker.asyncWorker!.prefetch=parallel;
 if(parallel===2)worker.size='medium';
 d.resources.find(r=>r.id==='queue')!.asyncQueue!.deadLetterCapacity=capacity;
 let contract=withRunLength(prepare(d).contract,70,'async-proof');
 contract=withTimeline(contract,burst ? [{id:'burst',kind:'load',atUs:0,fraction:8/3.5},{id:'normal',kind:'load',atUs:3000001,fraction:1}] : [{id:'stop',kind:'load',atUs:35000001,fraction:0}]);
 const c=compileProduct(d,contract);if(!c.ok)throw Error(JSON.stringify(c));
 const runtime=createProductModel2(c.value),workerConfig=c.value.input.resources.find(r=>r.kind==='async-worker')!;
 if(workerConfig.kind!=='async-worker')throw Error('Missing worker');
 const keys=new Set(workerConfig.poisonKeys),rows=[];
 let healthyAgeAt35=0;
 for(let second=1;second<=70;second++) {
  runtime.advanceTo(second*1000000);rows.push({second,...runtime.inspectQueue('queue')!,...runtime.inspectWorker('worker')!});
  if(second===35)healthyAgeAt35=Math.max(0,...runtime.evidence().asynchronous.brokers[0]!.messages.filter(m=>m.state==='ready'&&!keys.has(m.body.key)).map(m=>second*1000000-m.acceptedAt));
 }
 const evidence=runtime.evidence(),q=evidence.asynchronous.brokers[0]!,w=evidence.asynchronous.workers[0]!;
 const accepted=new Map(q.events.filter(e=>e.kind==='accepted').map(e=>[e.message,e.at]));
 const healthyDelays=new Map(w.events.filter(e=>e.kind==='object-effect').map(e=>[e.message,e.at-accepted.get(e.message)!]));
 return {compiled:c.value,rows,evidence,q,w,keys,healthyAgeAt35,healthyDelays};
}

test('poison consumes read and CPU for every attempt, delays healthy work and nacks without lease expiry',()=>{
 const control=poisonJourney(0),bad=poisonJourney(10),replay=poisonJourney(10);
 expect(bad.evidence).toEqual(replay.evidence);expect(bad.rows).toEqual(replay.rows);
 expect(control.rows[34]).toMatchObject({accepted:123,ready:0,processed:122,failed:0,failedCpuUs:0});
 expect(bad.rows[9]).toMatchObject({ready:2,oldestReadyAgeUs:1421817});
 expect(bad.rows[34]).toMatchObject({accepted:123,ready:8,inFlight:1,processed:105,failed:29,failedCpuUs:7250000,oldestReadyAgeUs:5567675});
 expect(bad.healthyAgeAt35).toBeGreaterThan(control.healthyAgeAt35);
 expect(Math.max(...bad.healthyDelays.values())).toBeGreaterThan(Math.max(...control.healthyDelays.values()));
 expect([...bad.healthyDelays].filter(([id,delay])=>delay>control.healthyDelays.get(id)!).length).toBeGreaterThan(80);
 expect(bad.keys.size).toBe(11);
 expect(bad.q).toMatchObject({accepted:123,deliveries:145,acknowledged:112,nacked:33,redelivered:22,deadLettered:11,dlqOverflow:0,leaseExpired:0,ready:0,inFlight:0,expired:0});
 expect(bad.w).toMatchObject({failed:33,reads:145,deliveries:145,effects:112,acknowledged:112});
 expect(bad.w.cpu.appCoreUs).toBe(36250000);
 expect(bad.rows[69]!.failedCpuUs).toBe(11*3*250000);
 expect(bad.q.redelivered).toBe(11*(3-1));expect(bad.q.deliveries-control.q.deliveries).toBe(22);
 for(const entry of bad.q.dlq)expect(entry.message.attempts).toBe(3);
 for(const key of bad.keys)expect(bad.q.events.filter(e=>e.kind==='delivery'&&JSON.parse(e.message)[0]===key)).toHaveLength(3);
});

test('bounded DLQ overflow discards remain counted and visible in revision 2 live and terminal metrics',()=>{
 const bad=poisonJourney(10,2);
 expect(bad.q).toMatchObject({deadLettered:2,discarded:9,dlqOverflow:9,nacked:33,redelivered:22});expect(bad.q.dlq).toHaveLength(2);
 const live=createLiveModel2(bad.compiled,['app','queue','worker','store']);
 for(let s=1;s<=70;s++)live.advanceSecond();
 expect(live.project().metrics.queue!.asyncQueue).toEqual({version:2,published:123,completed:112,readyDepth:0,oldestReadyAgeSeconds:null,inFlight:0,redeliveries:22,deadLettered:2,failedAttempts:33,deadLetterOverflowDiscards:9,wastedCpuSeconds:8.25});
});

test('lower bad share or more existing worker capacity drains a burst backlog while uploads continue',()=>{
 const bad=poisonJourney(10,1000,1,true),lower=poisonJourney(2,1000,1,true),faster=poisonJourney(10,1000,2,true);
 expect(bad.rows[2]!.ready).toBe(14);expect(bad.rows[69]!.ready).toBe(30);expect(bad.rows.every(r=>r.ready>0)).toBe(true);
 expect(lower.rows[2]!.ready).toBe(12);expect(lower.rows.find(r=>r.second>3&&r.ready===0)!.second).toBe(51);
 expect(faster.rows[2]!.ready).toBe(4);expect(faster.rows.find(r=>r.second>3&&r.ready===0)!.second).toBe(5);
 expect(Math.max(...faster.rows.slice(5).map(r=>r.ready))).toBe(1);
 expect(faster.rows[40]!.ready).toBe(1);expect(faster.rows[41]!.ready).toBe(0);
 expect(faster.rows[69]).toMatchObject({accepted:260,processed:235,ready:0});
 expect(lower.rows[69]!.accepted).toBe(260);
});

import { asyncFixture } from './asyncFixture';
import { quantities } from './workloadFixture';
import { createAsyncModel2 } from '../src/model2/async/run';

test('failed CPU accounting distinguishes failed reads from failure after completed CPU',()=>{
 for(const readFailure of [true,false]) {
  const input=asyncFixture({count:1,processing:6000,horizon:50000,maxAttempts:3,lease:30000}),q=quantities();
  input.asyncInterventions.push({id:'access',kind:'object-access',target:'objects',reads:!readFailure,writes:readFailure,at:q.q('access.at',readFailure?0:1000,'us'),duration:q.q('access.duration',49000,'us')});input.ledger.push(...q.ledger);
  const runtime=createAsyncModel2(input);runtime.advanceTo(49000);
  const worker=runtime.inspectWorker('worker-0')!,e=runtime.evidence().asynchronous.workers[0]!;
  expect(worker.failed).toBe(3);expect(worker.failedCpuUs).toBe(readFailure?0:18000);expect(e.cpu.appCoreUs).toBe(worker.failedCpuUs);
 }
});
