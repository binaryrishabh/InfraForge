import { definition, answers, attemptRow } from "./challengeHarness";
const d = definition("redrive-after-the-fix");
const get=(mark:boolean)=>{const s=structuredClone(d.starter!); if(!mark){delete (s.resources[1] as any).asyncQueue.redriveAtSecond; delete (s.resources[2] as any).asyncWorker.repairAtSecond;} return (attemptRow(d,s,answers(d,{health:"healthy"})) as any).terminalSnapshot;};
const a=get(false), b=get(true);
const flat=(o:any,p=""):Record<string,any>=>Object.fromEntries(Object.entries(o??{}).flatMap(([k,v])=>v&&typeof v==="object"&&!Array.isArray(v)?Object.entries(flat(v,p+k+".")):[[p+k,v]]));
const fa=flat(a), fb=flat(b); for(const k of new Set([...Object.keys(fa),...Object.keys(fb)])) if(JSON.stringify(fa[k])!==JSON.stringify(fb[k]) && !/metrics\.(queue|worker|store|app)\.(cpu|rps|queueWork|asyncQueue|connections|memory)/.test(k)) console.log(k, JSON.stringify(fa[k])?.slice(0,80), JSON.stringify(fb[k])?.slice(0,80));
console.log(JSON.stringify(b.metrics.queue.queueWork), JSON.stringify(b.metrics.queue.asyncQueue), JSON.stringify(a.metrics.queue.queueWork));
