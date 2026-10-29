import { createHash } from 'node:crypto';
import { RESOURCE_PORTS, type Resource } from '@infraforge/domain/resource';
import type { SavedProductDesign } from '../src/model2/product/contracts';
import { contractFromDesign } from '../src/model2/product/fromDesign';
import { compileProduct } from '../src/model2/product/compiler';
export function design(enabled = true, rps = 8): SavedProductDesign {
 const types: Record<string,Resource['type']> = enabled ? {app:'Virtual Machine',queue:'Message Queue',worker:'Virtual Machine',store:'Object Storage'} : {app:'Virtual Machine',queue:'Message Queue'};
 const links = enabled ? [['app','queue'],['app','store'],['queue','worker'],['worker','store']] : [['app','queue']];
 const saved: SavedProductDesign = {schema:'infraforge-saved-design/1',resources:Object.entries(types).map(([id,type])=>({id,type,x:0,y:0})),connections:links.map(([s,t],i)=>({id:`e${i}`,sourceId:s!,targetId:t!,sourceType:types[s!]!,targetType:types[t!]!,port:RESOURCE_PORTS[types[t!]!]})),workload:{targetThroughput:rps*60,throughputUnit:'per-minute',trafficShape:'steady',readWriteRatio:0.8,payloadSize:'light'}};
 if(enabled) { saved.resources.find(r=>r.id==='queue')!.asyncQueue={enabled:true,visibilityTimeoutSeconds:30,maxReceives:3,retentionSeconds:300}; saved.resources.find(r=>r.id==='worker')!.asyncWorker={enabled:true,concurrency:1,prefetch:1,cpuMsPerJob:250}; }
 return saved;
}
export function prepare(saved: SavedProductDesign) {
 const a=contractFromDesign(saved); if('refused' in a) throw Error(JSON.stringify(a));
 const c=compileProduct(saved,a.contract); if(!c.ok) throw Error(JSON.stringify(c));
 return {...a,compiled:c.value};
}
export const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v).replaceAll('\r\n','\n')).digest('hex');
