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

// Keep replay fixtures inside the backend workspace; only public packages cross boundaries.
function design(enabled = true) {
 const types: Record<string, Resource["type"]> = enabled ? {app:"Virtual Machine",queue:"Message Queue",worker:"Virtual Machine",store:"Object Storage"} : {app:"Virtual Machine",queue:"Message Queue"};
 const links = enabled ? [["app","queue"],["app","store"],["queue","worker"],["worker","store"]] : [["app","queue"]];
 const resources: Resource[] = Object.entries(types).map(([id,type])=>({id,type,x:0,y:0}));
 if(enabled) {resources.find(r=>r.id==="queue")!.asyncQueue={...DEFAULT_ASYNC_QUEUE_SETTINGS};resources.find(r=>r.id==="worker")!.asyncWorker={...DEFAULT_ASYNC_WORKER_SETTINGS};}
 return {resources,connections:links.map(([sourceId,targetId],i)=>({id:`e${i}`,sourceId:sourceId!,targetId:targetId!,sourceType:types[sourceId!]!,targetType:types[targetId!]!,port:RESOURCE_PORTS[types[targetId!]!]})),workload:{targetThroughput:480,throughputUnit:"per-minute" as const,trafficShape:"steady" as const,readWriteRatio:0.8,payloadSize:"light" as const}};
}

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
