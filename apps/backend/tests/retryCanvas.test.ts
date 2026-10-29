import { expect, test } from "bun:test";
import { DEFAULT_RETRY_SETTINGS, type Resource } from "@infraforge/domain/resource";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { layout, workload } from "./integration/scenario";
import { configuration, designDifference } from "../comparison/design";

const resource: Resource = {id:"lb",type:"Load Balancer",x:0,y:0,retry:DEFAULT_RETRY_SETTINGS};
test("retry policy survives layout save/load and captured replay inputs without defaults", () => {
  const layout=LayoutSchema.parse({resources:[resource],connectionLines:[]});
  expect(layout.resources[0]!.retry).toEqual(DEFAULT_RETRY_SETTINGS);
  const inputs=captureRunInputs(JSON.parse(JSON.stringify(layout)));
  expect(readRunInputs(JSON.parse(JSON.stringify(inputs))).resources[0]!.retry).toEqual(DEFAULT_RETRY_SETTINGS);
  expect(LayoutSchema.parse({resources:[{...resource,retry:undefined}]}).resources[0]).not.toHaveProperty("retry", DEFAULT_RETRY_SETTINGS);
});
test("both saved and live topology schemas enforce retry ownership and bounds", () => {
  for(const schema of [LayoutSchema, LiveTopologySchema]) {
    for(const retry of [{enabled:false},{...DEFAULT_RETRY_SETTINGS,enabled:false},DEFAULT_RETRY_SETTINGS]) expect(schema.safeParse({resources:[{...resource,retry}],connectionLines:[]}).success).toBe(true);
    for(const retry of [{...DEFAULT_RETRY_SETTINGS,maxAttempts:6},{...DEFAULT_RETRY_SETTINGS,backoffMs:0},{...DEFAULT_RETRY_SETTINGS,jitterRatio:2},{...DEFAULT_RETRY_SETTINGS,maxConcurrentRetries:65},{...DEFAULT_RETRY_SETTINGS,retryOn:[]},{...DEFAULT_RETRY_SETTINGS,retryOn:["unknown"]},{...DEFAULT_RETRY_SETTINGS,allowAmbiguousNonIdempotent:true}]) expect(schema.safeParse({resources:[{...resource,retry}],connectionLines:[]}).success).toBe(false);
    expect(schema.safeParse({resources:[{...resource,type:"Virtual Machine"}],connectionLines:[]}).success).toBe(false);
  }
});
test("retry-only edits remain visible in design improvement lineage", () => {
  const before={resources:[{...resource,retry:undefined}],connectionLines:[]}, after={resources:[resource],connectionLines:[]};
  expect(configuration(before.resources[0]!)).not.toHaveProperty("retry");
  expect(designDifference(before,after).reconfigured).toEqual([{id:"lb",fields:[{field:"retry",earlier:null,later:DEFAULT_RETRY_SETTINGS}]}]);
});

test("browser entry and server replay have identical retry-enabled views after saved input roundtrip", () => {
  const saved=structuredClone(layout);
  saved.resources.find((r)=>r.type === "Load Balancer")!.retry={...DEFAULT_RETRY_SETTINGS,retryOn:["connectionFailure","timeout","backendFailure"]};
  const captured=captureRunInputs(saved,workload,"retry-parity");
  const input=readRunInputs(JSON.parse(JSON.stringify(captured)));
  const browser=createModel2Run(input,5), server=createModel2Engine(input,5,buildModel2Contract);
  for(let s=0;s<5;s++) {
    if(s===2) {
      const action={kind:"chaos" as const,parameters:{type:"crash" as const,resourceId:"vm-a"}};
      expect(browser.apply(action)).toEqual(server.apply(action));
    }
    const stableLogs = (logs: ReturnType<typeof browser.advance>) => logs.map(({ timestamp: _wallClock, ...row }) => row);
    expect(stableLogs(browser.advance())).toEqual(stableLogs(server.advance()));
    expect(browser.view()).toEqual(server.view());
  }
  expect(browser.actions).toEqual(server.actions);
});
