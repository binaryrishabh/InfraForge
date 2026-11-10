import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gatewayQuotaError } from "@infraforge/domain/resource";
import { buildContractFromRunInputs, compileProduct } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { GatewayMetricsSchema } from "../reports/newResourceSchema";
import { configuration } from "../comparison/design";
import { quotaLayout, quotaWorkload } from "./gatewayQuota.fixture";
import { gatewayLayout, gatewayWorkload } from "./apiGateway.fixture";

test("saved quota scope spends shared credits once while route counters retain their own callers", () => {
  const rows = (["shared", "per-route"] as const).map(scope => {
    const input = captureRunInputs(quotaLayout(scope), quotaWorkload, "quota");
    expect(readRunInputs(JSON.parse(JSON.stringify(input)))).toEqual(input);
    expect(configuration(input.resources[0]!)).toHaveProperty("gatewayQuota", {version: 1, scope});
    const run = createModel2Engine(input, 6); for (let second = 0; second < 6; second++) run.advance();
    const metrics = run.view().metrics.gateway!.gateway!;
    expect(metrics).toEqual(GatewayMetricsSchema.parse(metrics));
    expect(metrics.routes.reduce((n, r) => n + r.admitted, 0)).toBe(metrics.admitted);
    expect(metrics.routes.reduce((n, r) => n + r.rejected, 0)).toBe(metrics.throttled);
    expect(metrics.quota).toEqual({profile: "gateway-quota/1", scope});
    const detached = run.evidence(); detached.asynchronous.gateways![0]!.routes[0]!.tokens = 999;
    expect(run.evidence().asynchronous.gateways![0]!.routes[0]!.tokens).toBeLessThanOrEqual(2);
    return metrics;
  });
  expect(rows.map(g => g.routes.map(r => [r.outcomes!.completed, r.rejected]))).toEqual([[[60,479],[1,60]],[[61,478],[61,0]]]);
  expect(rows.map(g => g.completed)).toEqual([61,122]);
});

test("quota capture and compiler refuse wrong ownership, unequal budgets, malformed settings and replay drift", () => {
  for (const setting of [null, {}, {version: 2, scope: "shared"}, {version: 1, scope: "global"}, {version: 1, scope: "shared", fairness: true}]) {
    const layout = quotaLayout(); Object.assign(layout.resources[0]!, {gatewayQuota: setting});
    expect(LayoutSchema.safeParse(layout).success).toBe(false);
    expect(gatewayQuotaError("API Gateway", setting, layout.resources[0]!.apiGateway)).toBeDefined();
  }
  for (const mutate of [(l:ReturnType<typeof quotaLayout>) => {l.resources[1]!.gatewayQuota = l.resources[0]!.gatewayQuota;},
    (l:ReturnType<typeof quotaLayout>) => {l.resources[0]!.apiGateway!.routes![1]!.burstRequests = 3;},
    (l:ReturnType<typeof quotaLayout>) => {l.resources[0]!.apiGateway!.routes![1]!.requestsPerSecond = 11;},
    (l:ReturnType<typeof quotaLayout>) => {l.resources[0]!.apiGateway!.routes!.pop();}]) {
    const layout = quotaLayout(); mutate(layout); expect(LayoutSchema.safeParse(layout).success).toBe(false);
    expect(buildContractFromRunInputs({...captureRunInputs(quotaLayout(), quotaWorkload, "refuse"), resources: layout.resources},6)).toHaveProperty("refused");
  }
  const input = captureRunInputs(quotaLayout(), quotaWorkload, "refuse");
  expect(buildContractFromRunInputs({...input, adapterProfiles: input.adapterProfiles!.filter(p => p !== "gateway-quota/1")}, 6)).toHaveProperty("refused");
  const legacy = structuredClone(input); delete legacy.resources[0]!.gatewayQuota;
  expect(buildContractFromRunInputs(legacy,6)).toHaveProperty("refused");
  const built = buildContractFromRunInputs(input,6); if ("refused" in built) throw Error(built.refused.join());
  for (const mutate of [(c: typeof built.contract) => {c.version=c.version.replace("gateway-quota/1","gateway-quota/10");},
    (c: typeof built.contract) => {const r=c.nodes.gateway!.resources[0]!.config;if(r.kind==="api-gateway")r.quota!.scope="per-route";},
    (c: typeof built.contract) => {const r=c.nodes.gateway!.resources[0]!.config;if(r.kind==="api-gateway")delete r.quota;},
    (c: typeof built.contract) => {const r=c.nodes.gateway!.resources[0]!.config;if(r.kind==="api-gateway")Object.assign(r.quota!,{owner:"other"});}]) {
    const contract=structuredClone(built.contract);mutate(contract);
    expect(compileProduct({schema:"infraforge-saved-design/1",resources:input.resources,connections:input.connectionLines,workload:input.workloadProfile},contract).ok).toBe(false);
  }
});

test("quota report observations reject contradictions and never infer missing scope", () => {
  const run=createModel2Engine(captureRunInputs(quotaLayout(),quotaWorkload,"observations"),6);run.advance();
  const g=run.view().metrics.gateway!.gateway!;
  for (const mutate of [(m:typeof g)=>{m.quota!.scope="per-route";Object.assign(m.quota!,{owner:"other"});},
    (m:typeof g)=>{m.routes[1]!.tokens++;},(m:typeof g)=>{m.routes[1]!.capacity++;},
    (m:typeof g)=>{m.routes[0]!.rejected=-1;},(m:typeof g)=>{m.routes[0]!.outcomes!.completed++;}]) {
    const bad=structuredClone(g);mutate(bad);expect(GatewayMetricsSchema.safeParse(bad).success).toBe(false);
  }
  const historical=structuredClone(g);delete historical.quota;
  expect(GatewayMetricsSchema.parse(historical)).not.toHaveProperty("quota");
});

test("unmarked gateway raw evidence retains pre-slice bytes at both captured seconds", () => {
  // Measured from the 9b79bee simulation source before authoring the lab. These
  // are regression-only probes, not published challenge or golden updates.
  const hashes = [["92cf099c3750699b7ac2d2e9e88e77447c87ef21dd5c3990ea64ec68385f1958", "c0497713d08f1ab927f71a98bb14ccc9b1330381839aa41c16eea0e228f582e9"],
    ["300892a20d95cb0033f5c02e32bd1aa12e87280e4d4b26af38e9692bd79873f5", "8f867ebba375fe3f9e163e3e46dce0113d159f74822e7c33c5174398bf5f7426"]];
  for (const [i,burst] of [1,100].entries()) {
    const run=createModel2Engine(captureRunInputs(gatewayLayout(burst),gatewayWorkload,"nx10-legacy"),2);
    for(let s=0;s<2;s++) {run.advance();expect(createHash("sha256").update(JSON.stringify(run.evidence())).digest("hex")).toBe(hashes[i]![s]!);expect(run.view().metrics.gateway!.gateway).not.toHaveProperty("quota");}
  }
});
