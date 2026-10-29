import { expect, test } from "bun:test";
import { DEFAULT_CIRCUIT_BREAKER_SETTINGS } from "@infraforge/domain/resource";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { designDifference } from "../comparison/design";

const resource = {id:"lb",type:"Load Balancer" as const,x:0,y:0,circuitBreaker:DEFAULT_CIRCUIT_BREAKER_SETTINGS};
test("saved/live layouts validate and retain circuit breaker intent without injected defaults",()=>{
  for(const schema of [LayoutSchema,LiveTopologySchema]) {
    const layout=schema.parse({resources:[resource],connectionLines:[]});
    expect(layout.resources[0]!.circuitBreaker).toEqual(DEFAULT_CIRCUIT_BREAKER_SETTINGS);
    expect(readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout)))).resources[0]!.circuitBreaker).toEqual(DEFAULT_CIRCUIT_BREAKER_SETTINGS);
    for(const patch of [{failureThreshold:0},{failureThreshold:101},{cooldownMs:0},{cooldownMs:60001},{maxProbes:2}]) expect(schema.safeParse({resources:[{...resource,circuitBreaker:{...DEFAULT_CIRCUIT_BREAKER_SETTINGS,...patch}}],connectionLines:[]}).success).toBe(false);
    expect(schema.safeParse({resources:[{...resource,type:"Virtual Machine"}],connectionLines:[]}).success).toBe(false);
    expect(schema.parse({resources:[{...resource,circuitBreaker:{enabled:false}}],connectionLines:[]}).resources[0]!.circuitBreaker).toEqual({enabled:false});
  }
});
test("breaker settings appear in improvement lineage",()=>{
  const before={resources:[{...resource,circuitBreaker:undefined}],connectionLines:[]},after={resources:[resource],connectionLines:[]};
  expect(designDifference(before,after).reconfigured).toEqual([{id:"lb",fields:[{field:"circuitBreaker",earlier:null,later:DEFAULT_CIRCUIT_BREAKER_SETTINGS}]}]);
});
