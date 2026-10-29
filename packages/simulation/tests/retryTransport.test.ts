import { test, expect } from "bun:test";
import { verticalFixture } from "./networkFixture";
import { quantities } from "./workloadFixture";
import { createNetworkModel2 } from "../src/model2/network/run";
import type { LoadBalancer } from "../src/model2/network/contracts";

test("canvas retry profile resends real network work through pools, app and downstream", () => {
  const input=verticalFixture({count:1,cpu:100,connections:4,horizon:19999}), {q,ledger}=quantities();
  const lb=input.resources.find((r): r is LoadBalancer=>r.kind === "load-balancer")!;
  lb.retry={profile:"canvas-retries/1",enforceCallerDeadline:true,reserveBackoffBudget:true,preferDifferentBackend:true,maxAttempts:q("tries",2,"count"),backoff:q("backoff",100,"us"),jitter:q("jitter",0,"ratio"),maxConcurrentRetries:q("budget",4,"count"),retryOn:["reset"],allowAmbiguousNonIdempotent:false};
  input.networkInterventions=[{id:"transient-reset",kind:"reset",target:"lb:a",at:q("reset",250,"us")}];input.ledger.push(...ledger);
  const run=()=>{const m=createNetworkModel2(input);m.advanceTo(m.horizon);return m.evidence();};
  const e=run(); expect(e).toEqual(run());
  expect(e.network.loadBalancers[0]).toMatchObject({attempts:2,retries:1,retriesWaiting:0,activeRetries:0});
  expect(e.counts.completed).toBe(1);
  expect(e.network.paths.find((p)=>p.id === "lb:b")!.completed).toBeGreaterThan(0);
  expect(e.network.paths.find((p)=>p.id === "b:dep")!.completed).toBeGreaterThan(0);
  expect(e.network.paths.every((p)=>p.pool.activeStreams === 0)).toBe(true);
});
