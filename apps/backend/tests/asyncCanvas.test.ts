import { RESOURCE_PORTS, DEFAULT_ASYNC_QUEUE_SETTINGS, DEFAULT_ASYNC_WORKER_SETTINGS, type Resource } from "@infraforge/domain/resource";
import type { ExperimentEvidencePayload } from "@infraforge/contracts/reports";
import { test, expect } from 'bun:test';
import { LayoutSchema, LiveTopologySchema } from '../zod_schemas/layout.schema';
import { captureRunInputs, readRunInputs } from '../deployments/runInputs';
import { createModel2Run } from '@infraforge/simulation/model2-run';
import { createModel2Engine } from '../simulator/model2Engine';
import { buildModel2Contract } from '../simulator/contractBuilder';
import { designDifference } from '../comparison/design';
import { evidencePayload, sampleHash } from '../evidence/contract';
import { checkSubmission } from '../browserRuns/submission';
import { applyAction } from '../simulator/actionApplication';
import { actionCompletion } from '../simulator/actionCompletion';
import { actionDto } from '../actions/contract';
import type { RunAction as StoredAction } from '../lib/generated/prisma/client';

// Keep replay fixtures inside the backend workspace; only public packages cross boundaries.
function design(enabled = true) {
 const types: Record<string, Resource["type"]> = enabled ? {app:"Virtual Machine",queue:"Message Queue",worker:"Virtual Machine",store:"Object Storage"} : {app:"Virtual Machine",queue:"Message Queue"};
 const links = enabled ? [["app","queue"],["app","store"],["queue","worker"],["worker","store"]] : [["app","queue"]];
 const resources: Resource[] = Object.entries(types).map(([id,type])=>({id,type,x:0,y:0}));
 if(enabled) {resources.find(r=>r.id==="queue")!.asyncQueue={...DEFAULT_ASYNC_QUEUE_SETTINGS};resources.find(r=>r.id==="worker")!.asyncWorker={...DEFAULT_ASYNC_WORKER_SETTINGS};}
 return {resources,connections:links.map(([sourceId,targetId],i)=>({id:`e${i}`,sourceId:sourceId!,targetId:targetId!,sourceType:types[sourceId!]!,targetType:types[targetId!]!,port:RESOURCE_PORTS[types[targetId!]!]})),workload:{targetThroughput:480,throughputUnit:"per-minute" as const,trafficShape:"steady" as const,readWriteRatio:0.8,payloadSize:"light" as const}};
}

test('consumer outage wire, durable timing, receipt and exact server replay stay consistent',()=>{
 const d=design();d.workload.targetThroughput=210;
 const input=readRunInputs(captureRunInputs({resources:d.resources,connectionLines:d.connections},d.workload,'async-proof'));
 const request={kind:'intervention' as const,parameters:{interventionId:'consumer-outage',revision:1,target:{resourceId:'worker'},parameters:{duration:5}}};
 const submission={stopAtSecond:3,actions:[{atSecond:1,request}]};
 expect(checkSubmission(JSON.parse(JSON.stringify(submission)),{horizonSeconds:70,challenge:false})).toEqual(submission);
 for(const parameters of [{...request.parameters,revision:2},{...request.parameters,parameters:{duration:0}},{...request.parameters,parameters:{duration:1,available:false}}])
  expect(()=>checkSubmission({...submission,actions:[{atSecond:1,request:{...request,parameters}}]},{horizonSeconds:70,challenge:false})).toThrow();
 expect(()=>checkSubmission(submission,{horizonSeconds:70,challenge:true})).toThrow('challenge');
 expect(()=>checkSubmission({stopAtSecond:70,actions:[{atSecond:69,request}]},{horizonSeconds:70,challenge:false})).toThrow('BOUNDS');
 const browser=createModel2Run(input,70),server=createModel2Engine(JSON.parse(JSON.stringify(input)),70,buildModel2Contract);
 browser.advance();server.advance();
 const instance={model2:server,actions:new Map(),pendingLogs:[]} as unknown as SimulationInstance;
 const applied=applyAction(instance,'durable',request);expect(applied.outcome).toEqual(browser.apply(request).outcome);
 const running=instance.actions.get('durable')!;
 for(let second=2;second<=7;second++) {
  browser.advance();server.advance();expect(browser.view()).toEqual(server.view());expect(browser.evidence()).toEqual(server.evidence());
  expect(actionCompletion(instance,running)===null).toBe(second<7);
 }
 const done=actionCompletion(instance,running)!;expect(done.outcome).toMatchObject({interventionEnded:true});
 const now=new Date(), row={id:'durable',deploymentId:'run',sequence:1,...request,status:'completed',requestedAt:now,appliedAt:now,completedAt:now,appliedSimulatedSeconds:1,completedSimulatedSeconds:7,outcome:done.outcome,failureReason:null} as unknown as StoredAction;
 expect(actionDto(row).outcome?.intervention).toEqual(applied.outcome.intervention);
 expect(()=>actionDto({...row,completedSimulatedSeconds:6})).toThrow('precedes');
 expect(()=>actionDto({...row,outcome:{...done.outcome,intervention:{...done.outcome.intervention!,endUs:6_000_000}}} as unknown as StoredAction)).toThrow('timing');
 expect(Buffer.byteLength(JSON.stringify(done.outcome),'utf8')).toBeLessThan(24*1024);
});

test('async intent survives saving, capture and comparison without defaults',()=>{
 const d=design();const layout={resources:d.resources,connectionLines:d.connections};
 for(const schema of [LayoutSchema,LiveTopologySchema]) {
  expect<Resource[]>(schema.parse(layout).resources).toEqual(d.resources);
  for(const patch of [{concurrency:0},{prefetch:65},{cpuMsPerJob:0},{concurrency:2,prefetch:1},{cpuMsPerJob:1.5},{unknown:1}]) {
   const bad=structuredClone(layout);bad.resources.find(r=>r.id==='worker')!.asyncWorker={...bad.resources.find(r=>r.id==='worker')!.asyncWorker!,...patch};expect(schema.safeParse(bad).success).toBe(false);
  }
  for(const patch of [{visibilityTimeoutSeconds:0},{retentionSeconds:86401},{maxReceives:11},{maxReceives:undefined}]) {
   const bad=structuredClone(layout);bad.resources.find(r=>r.id==='queue')!.asyncQueue={...bad.resources.find(r=>r.id==='queue')!.asyncQueue!,...patch};expect(schema.safeParse(bad).success).toBe(false);
  }
 }
 const captured=readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout,d.workload,'async-parity'))));
 expect(captured.resources).toEqual(d.resources);
 const before=structuredClone(layout);delete before.resources.find(r=>r.id==='worker')!.asyncWorker;
 expect(designDifference(before,layout).reconfigured[0]!.fields[0]!.field).toBe('asyncWorker');
 expect(LayoutSchema.parse({resources:design(false).resources}).resources.every(r=>r.asyncQueue===undefined && r.asyncWorker===undefined)).toBe(true);
});
test('queue journey browser/server parity includes load reduction and real draining metrics',()=>{
 const d=design(),input=readRunInputs(captureRunInputs({resources:d.resources,connectionLines:d.connections},d.workload,'async-parity'));
 const browser=createModel2Run(input,30),server=createModel2Engine(input,30,buildModel2Contract);
 for(let i=0;i<30;i++) {
  if(i===10) {const action={kind:'load' as const,parameters:{targetLoadFraction:0.125}};expect(browser.apply(action)).toEqual(server.apply(action));}
  const stable=(logs:ReturnType<typeof browser.advance>)=>logs.map(({timestamp:_wall,...row})=>row);
  expect(stable(browser.advance())).toEqual(stable(server.advance()));expect(browser.view()).toEqual(server.view());
 }
 expect(browser.view().metrics.queue!.asyncQueue!.readyDepth).toBe(0);
 expect(browser.view().metrics.queue!.asyncQueue!.oldestReadyAgeSeconds).toBeNull();
});
test('evidence v3 alone accepts queue counters and keeps historical hashes stable',()=>{
 const base: ExperimentEvidencePayload={version:2,topologyRevision:0,overallHealth:'healthy',loadFraction:1,targetLoadFraction:1,resources:[{id:'queue',health:'healthy',cpu:null,memory:null}],pools:[]};
 const old=sampleHash(base);expect(evidencePayload.parse(base)).toEqual(base);
 const metrics={version:1,published:10,completed:5,readyDepth:4,oldestReadyAgeSeconds:2,inFlight:1,redeliveries:0,deadLettered:0};
 const next={...base,version:3,resources:[{...base.resources[0],asyncQueue:metrics}]};
 expect(evidencePayload.safeParse(next).success).toBe(true);
 expect(evidencePayload.safeParse({...next,version:2}).success).toBe(false);
 expect(sampleHash(base)).toBe(old);expect(sampleHash(next)).not.toBe(old);
 expect(evidencePayload.safeParse({...next,resources:[{...next.resources[0],asyncQueue:{...metrics,oldestReadyAgeSeconds:null}}]}).success).toBe(true);
});
import { captureEvidenceTick } from '../evidence/capture';
import type { SimulationInstance } from '../simulator/instance';

test('capturing a real opt-in run chooses v3 and retains queue values',()=>{
 const d=design(),input=captureRunInputs({resources:d.resources,connectionLines:d.connections},d.workload,'capture-async');
 const instance: SimulationInstance = {model2:createModel2Engine(input,5,buildModel2Contract),tickCount:0,pendingLogs:[],speed:1,lastCheckpointAt:0,accumulatedCostUsd:0,topology:input,topologyRevision:0,actions:new Map(),acknowledge:null,metricsComputedAt:null,metricsTopologyRevision:0,evidence:{window:{start:1,end:5},pending:[]}};
 instance.model2.advance();instance.metricsComputedAt=new Date().toISOString();captureEvidenceTick(instance);
 const payload=instance.evidence!.pending[0]!.payload;
 expect(payload.version).toBe(3);expect(payload.resources.find(r=>r.id==='queue')!.asyncQueue).toMatchObject({published:8,completed:3,readyDepth:4,inFlight:1,redeliveries:0,deadLettered:0});
});

test('poison browser/server replay agrees through retries, DLQ overflow and backlog drain',()=>{
 const d=design();d.workload.targetThroughput=210;
 d.resources.find(r=>r.id==='worker')!.asyncWorker!.badJobPercent=10;
 d.resources.find(r=>r.id==='queue')!.asyncQueue!.deadLetterCapacity=2;
 const layout={resources:d.resources,connectionLines:d.connections};
 for(const schema of [LayoutSchema,LiveTopologySchema]) {
  expect<Resource[]>(schema.parse(layout).resources).toEqual(d.resources);
  for(const [owner,field,values] of [['worker','badJobPercent',[-1,101,0.5,'10']],['queue','deadLetterCapacity',[-1,1001,1.5,'2']]] as const)for(const value of values){
   const bad=structuredClone(layout),resource=bad.resources.find(r=>r.id===owner)!;
   Object.assign(owner==='worker'?resource.asyncWorker!:resource.asyncQueue!,{[field]:value});expect(schema.safeParse(bad).success).toBe(false);
  }
 }
 const input=readRunInputs(captureRunInputs(layout,d.workload,'async-proof'));
 expect(input.resources).toEqual(d.resources);
 const browser=createModel2Run(input,70),server=createModel2Engine(input,70,buildModel2Contract);
 const samples=[];
 for(let i=0;i<70;i++) {
  if(i===35){const action={kind:'load' as const,parameters:{targetLoadFraction:0}};expect(browser.apply(action)).toEqual(server.apply(action));}
  const stable=(logs:ReturnType<typeof browser.advance>)=>logs.map(({timestamp:_wall,...row})=>row);
  expect(stable(browser.advance())).toEqual(stable(server.advance()));expect(browser.view()).toEqual(server.view());
  samples.push(browser.view().metrics.queue!.asyncQueue);
 }
 expect(samples[34]).toMatchObject({version:2,readyDepth:8,failedAttempts:29,deadLetterOverflowDiscards:7,wastedCpuSeconds:7.25});
 expect(samples[69]).toEqual({version:2,published:123,completed:112,readyDepth:0,oldestReadyAgeSeconds:null,inFlight:0,redeliveries:22,deadLettered:2,failedAttempts:33,deadLetterOverflowDiscards:9,wastedCpuSeconds:8.25});
 const before=structuredClone(layout);before.resources.find(r=>r.id==='worker')!.asyncWorker!.badJobPercent=0;
 const diff=designDifference(before,layout);expect(JSON.stringify(diff)).toContain('badJobPercent');expect(JSON.stringify(diff)).not.toContain('[object Object]');
});

test('poison failure observations stay live while persisted evidence retains DB-compatible revision 1',()=>{
 const d=design();d.workload.targetThroughput=210;
 d.resources.find(r=>r.id==='worker')!.asyncWorker!.badJobPercent=100;
 d.resources.find(r=>r.id==='queue')!.asyncQueue!.deadLetterCapacity=0;
 const input=captureRunInputs({resources:d.resources,connectionLines:d.connections},d.workload,'async-proof');
 const instance: SimulationInstance = {model2:createModel2Engine(input,5,buildModel2Contract),tickCount:0,pendingLogs:[],speed:1,lastCheckpointAt:0,accumulatedCostUsd:0,topology:input,topologyRevision:0,actions:new Map(),acknowledge:null,metricsComputedAt:null,metricsTopologyRevision:0,evidence:{window:{start:1,end:5},pending:[]}};
 for(let i=0;i<5;i++)instance.model2!.advance();
 const live=instance.model2!.view().metrics.queue!.asyncQueue!;
 expect(live).toMatchObject({version:2,deadLettered:0});if(live.version!==2)throw Error('Missing failure observations');
 expect(live.failedAttempts).toBeGreaterThan(0);expect(live.wastedCpuSeconds).toBeGreaterThan(0);expect(live.deadLetterOverflowDiscards).toBeGreaterThan(0);
 instance.metricsComputedAt=new Date().toISOString();captureEvidenceTick(instance);
 const saved=instance.evidence!.pending[0]!.payload.resources.find(r=>r.id==='queue')!.asyncQueue!;
 expect(saved.version).toBe(1);expect(saved).not.toHaveProperty('failedAttempts');expect(saved).not.toHaveProperty('wastedCpuSeconds');expect(saved).not.toHaveProperty('deadLetterOverflowDiscards');
 expect(evidencePayload.safeParse({...instance.evidence!.pending[0]!.payload,resources:[{id:'queue',health:'degraded',cpu:null,memory:null,asyncQueue:live}]}).success).toBe(false);
});
