import { expect, test } from "bun:test";
import { cachePolicyError, dataKeyspaceError } from "@infraforge/domain/resource";
import { starter } from "../challenges/starter";
import { captureRunInputs, readRunInputs, ADAPTER_PROFILE_CAP, ADAPTER_PROFILE_IDS } from "../deployments/runInputs";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { createModel2Engine } from "../simulator/model2Engine";

const design = (ttl = 0) => starter([["app","Virtual Machine",0,0],["cache","Cache",1,0,{cachePolicy:{version:2,capacityEntries:64,negativeTtlSeconds:ttl}}],["db","Database",1,1,{dataKeyspace:{version:1,count:10,absentCount:8}}]],[["app","cache"],["app","db"]]);
const workload = {targetThroughput:6000,throughputUnit:"per-minute" as const,trafficShape:"steady" as const,peakMultiplier:1,readWriteRatio:1,payloadSize:"light" as const};
test("negative caching strictly validates its saved fields and captures both values with headroom",()=>{
  expect(ADAPTER_PROFILE_CAP-ADAPTER_PROFILE_IDS.length).toBeGreaterThan(10);
  for(const ttl of [0,1,3600]) {const i=captureRunInputs(design(ttl),workload,"seed");expect(i.adapterProfiles).toContain("cache-negative/1");expect(readRunInputs(JSON.parse(JSON.stringify(i)))).toEqual(i);expect("contract" in buildContractFromRunInputs(i,2)).toBe(true);}
  for(const bad of [-1,1.5,3601,NaN,null,"1",true]) {
    expect(cachePolicyError("Cache",{version:1,negativeTtlSeconds:bad})).toBeDefined();
    const s=design();Object.assign(s.resources[1]!.cachePolicy!,{negativeTtlSeconds:bad});expect(()=>captureRunInputs(s,workload,"seed")).toThrow();
  }
  for(const bad of [-1,11,1.5,null,"1",true]) {
    expect(dataKeyspaceError("Database",{version:1,count:10,absentCount:bad})).toBeDefined();
    const s=design();Object.assign(s.resources[2]!.dataKeyspace!,{absentCount:bad});expect(()=>captureRunInputs(s,workload,"seed")).toThrow();
  }
  expect(cachePolicyError("Cache",{version:1,negativeTtlSeconds:0,typo:1})).toBeDefined();
  expect(dataKeyspaceError("Database",{version:1,count:10,absentCount:1,typo:1})).toBeDefined();
});
test("an absent key is a successful empty query result, distinct from a key outside the bounded dataset",()=>{
  const m=createModel2Engine(captureRunInputs(design(),workload,"seed"),2);m.advance();m.advance();
  const e=m.evidence() as {data:{databases:Array<{rows:unknown[]}>;applications:Array<{negative?:{absentAnswers:number;negativeHits:number;absentSourceReads:number}}>}};
  expect(e.data.databases[0]!.rows).toHaveLength(2);expect(e.data.applications[0]!.negative!.absentAnswers).toBeGreaterThan(100);expect(e.data.applications[0]!.negative!.negativeHits).toBe(0);
});
test("missing profile and unsupported source visibility are refused",()=>{
  const i=captureRunInputs(design(),workload,"seed"); i.adapterProfiles=i.adapterProfiles!.filter(p=>p!=="cache-negative/1");expect("refused" in buildContractFromRunInputs(i,2)).toBe(true);
  expect("refused" in buildContractFromRunInputs(captureRunInputs(design(),{...workload,readWriteRatio:0.5},"seed"),2)).toBe(true);
  for(const feature of ["databaseReplication","rowLocking","applicationFlow","staleSeconds","invalidateOnWrite"]){
    const s=design(); if(feature==="staleSeconds")s.resources[1]!.cachePolicy!.staleSeconds=1;
    else if(feature==="invalidateOnWrite")s.resources[1]!.cachePolicy!.invalidateOnWrite=true;
    else if(feature==="databaseReplication")s.resources[2]!.databaseReplication={version:1,enabled:true,replicationDelayMs:10,readPolicy:"primary"};
    else if(feature==="rowLocking")s.resources[2]!.rowLocking={version:1,rowsPerWrite:2,order:"by-key"};
    else s.resources[0]!.applicationFlow={schema:"application-flow/1",operations:{read:{steps:[{id:"cpu",kind:"compute"}]}}};
    expect("refused" in buildContractFromRunInputs(captureRunInputs(s,workload,"seed"),2)).toBe(true);
  }
});
