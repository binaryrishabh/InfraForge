import { definition } from "./challengeHarness";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
const d = definition("redrive-after-the-fix");
const input = captureRunInputs(d.starter!, d.workload, "p"); const e = createModel2Engine(input, 90);
for (let s=1;s<=60;s++){ e.advance(); if ([10,19,21,25,29,31,40,60].includes(s)) { const v:any=(e as any).view?.() ?? {}; const m=v.metrics?.queue?.queueWork; console.log(s, JSON.stringify(m)); } }
