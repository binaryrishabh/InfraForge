import { expect, test } from "bun:test";
import { busiestTypes } from "../challenges/criteria";
import { experimentReadiness } from "../challenges/experiment";
import { findChallenge } from "../challenges/registry";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";

test("busiest type ignores unknown CPU, including when every known value is zero", () => {
  const topology = { resources: [{id:"lb",type:"Load Balancer"},{id:"vm",type:"Virtual Machine"}], connectionLines: [] } as Parameters<typeof busiestTypes>[1];
  const terminal = { resources: [{id:"lb",cpu:null},{id:"vm",cpu:0}] } as unknown as ReportCheckpoint;
  expect(busiestTypes(terminal, topology)).toEqual({types:["Virtual Machine"],cpu:0});
  expect(busiestTypes({resources:[{id:"lb"}]} as ReportCheckpoint, topology).types).toEqual([]);
});
test("Model 2 keeps a crash target routable behind a fixed load balancer", () => {
  const d = findChallenge("lose-an-app-server",1)!.definition;
  const design = {...d.starter!, resources:d.starter!.resources.map(r=>r.id==="lb"?{...r,autoscaling:{enabled:false}}:r)};
  expect(experimentReadiness(d.experiment!,design,"2").ready).toBe(true);
  expect(experimentReadiness(d.experiment!,design).ready).toBe(false);
});

import { choicesFor } from "../challenges/prediction";
test("Model 2 busiest choices omit routing and policy nodes without CPU", () => {
  expect(choicesFor("busiest-type", ["Virtual Machine", "Load Balancer", "Firewall"], "2")).toEqual(["Virtual Machine"]);
  expect(choicesFor("busiest-type", ["Load Balancer"])).toEqual(["Load Balancer"]);
});
