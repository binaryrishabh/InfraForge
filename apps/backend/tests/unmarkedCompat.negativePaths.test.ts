import {createHash} from "node:crypto";
import {expect,test} from "bun:test";
import {starter} from "../challenges/starter";
import {captureRunInputs} from "../deployments/runInputs";
import {createModel2Engine} from "../simulator/model2Engine";
import {buildContractFromRunInputs} from "@infraforge/simulation/internal-product";

// Captured on the CX3 integration baseline with all changed production files restored to baseline bytes.
// Cache-owned helpers and a pre-existing stale policy supplement the app-owned helper digests. Never regenerate.
const sha=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0,16);
const pins={
 cacheOwned:["aca8b389433e8103","7086fedd7e860105","d98f407d13f50419",["985922c9950586e7","43a34ce91448b41d","c2d0d44ac542d019"]],
 cacheOwnedStale:["cbdc927ec7868c5b","b77de34861cda9ce","6dc5742c2c671a0b",["518578dbc80995f2","6f14974ed94195f8","0049de5e32adba87"]],
};
for(const stale of [false,true])test(`unmarked negative-cache path: cache-owned helper, stale ${stale}`,()=>{
 const name=stale?"cacheOwnedStale":"cacheOwned",design=starter([["app","Virtual Machine",0,0],["cache","Cache",1,0,{cachePolicy:{version:2,capacityEntries:16,ttlSeconds:1,singleFlight:true,...(stale?{staleSeconds:3}:{})}}],["db","Database",2,0,{dataKeyspace:{version:1,count:4}}]],[["app","cache"],["cache","db"]]);
 const workload={targetThroughput:6000,throughputUnit:"per-minute" as const,trafficShape:"steady" as const,peakMultiplier:1,readWriteRatio:1,payloadSize:"light" as const};
 const i=captureRunInputs(design,workload,`synth:${name}`),m=createModel2Engine(i,12),views=[];
 expect(i.adapterProfiles).not.toContain("cache-negative/1");
 for(let s=1;s<=12;s++){m.advance();if(s%4===0)views.push(sha(m.view()));}
 expect([sha(i),sha(buildContractFromRunInputs(i,12)),sha(m.evidence()),views]).toEqual(pins[name]);
},120000);
