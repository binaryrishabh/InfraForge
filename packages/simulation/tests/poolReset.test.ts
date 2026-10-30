import { expect, test } from "bun:test";
import { securityDesign, prepareSecurity } from "./securityCanvas.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withTimeline, type TimedAction } from "../src/model2/product/timeline";
import { intervention, interventionInput, advance } from "./interventionFixture";
import { quantities } from "./workloadFixture";
import { compileInterventions } from "../src/model2/product/interventions";
import { derivedLedger } from "../src/model2/product/provenance";
import { createModel2Run } from "../src/model2/product/liveRun";
import { resetEvidence, resetIds, freshOpen, RESET_EVIDENCE_BYTES } from "../src/model2/network/resetEvidence";

const request = intervention("pool-reset", {}, {edgeId: "edge-1", direction: "both"}).parameters;
const reset: TimedAction = {id: "reset", atUs: 2_000_000, kind: "intervention", request};
function setup(actions: TimedAction[] = []) {
  const design = securityDesign(), {contract} = prepareSecurity(design);
  const compiled = compileProduct(design, withTimeline(contract, actions));
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return {design, contract, compiled: compiled.value};
}

test("drawn-edge pool reset preserves commits, closes one connection and opens a fresh one", () => {
  const baseline = createProductModel2(setup().compiled), f = setup([reset]), run = createProductModel2(f.compiled);
  expect(f.compiled.interventionReceipts).toMatchObject([{resolvedTargets: ["edge-1:app:db"], affectedPaths: ["edge-1:app:db"], endUs: null}]);
  expect(f.compiled.input.networkInterventions).toMatchObject([{kind: "reset", target: "edge-1:app:db", evidenceActionId: "reset"}]);
  for (const r of [baseline, run]) r.advanceTo(3_000_000);
  const b = baseline.evidence(), e = run.evidence();
  expect([b.data.databases[0]!.transactions.committed, e.data.databases[0]!.transactions.committed]).toEqual([31,31]);
  expect(b.network.paths.find(p => p.id === "edge-1:app:db")!.pool).toMatchObject({created: 1, closed: 0});
  expect(e.network.paths.find(p => p.id === "edge-1:app:db")!.pool).toMatchObject({created: 2, closed: 1});
  expect(e.network.poolResets).toMatchObject({omitted: 0, closedConnections: 1, failedStreams: 0, rows: [{actionId: "reset", pathId: "edge-1:app:db", atUs: 2_000_000, closedConnections: 1, failedStreams: 0, freshOpens: {opened: 1, failed: 0}}]});
  expect(b.network.poolResets).toBeUndefined();
  expect(run.activeInterventions()).toEqual([]);
  expect(run.appliedInterventions()).toHaveLength(1);
});

test("reset during deny-port turns established reuse into ten denials and recovers after restore", () => {
  const deny: TimedAction = {id: "deny", atUs: 1_000_001, kind: "intervention", request: intervention("deny-port", {port: 5432, duration: 2}, {resourceId: "firewall"}).parameters};
  const runs = [setup([deny]), setup([deny, reset])].map(f => createProductModel2(f.compiled));
  for (const r of runs) r.advanceTo(3_000_000);
  const es = runs.map(r => r.evidence());
  expect(es.map(e => e.data.databases[0]!.transactions.committed)).toEqual([31,21]);
  expect(es.map(e => e.systems.security.policies[0]!.denied)).toEqual([0,10]);
  expect(es[1]!.network.poolResets!.rows[0]!.freshOpens).toMatchObject({opened: 0, failed: 10, omitted: 6});
  expect(es[1]!.network.poolResets!.rows[0]!.freshOpens.results.every(r => r.result === "backend-rejected")).toBe(true);
  expect(es[1]!.systems.security.events.rows.some(r => r.detail.includes("policy-denied:firewall:egress:intervention:deny:deny-port"))).toBe(true);
  runs[1]!.advanceTo(4_000_000);
  expect(runs[1]!.evidence().data.databases[0]!.transactions.committed).toBe(31);
  expect(runs[1]!.evidence().network.poolResets!.rows[0]!.freshOpens.opened).toBe(1);
});

test("pool reset refuses revisions, direction aliases and same-timestamp saved resets", () => {
  const {design, contract, compiled} = setup();
  for (const r of [{...request, revision: 2}, {...request, parameters: {duration: 1}}, {...request, target: {edgeId: "edge-1", direction: "request" as const}}]) {
    const c = compileProduct(design, {...contract, interventions: [{id: "bad", atUs: 1, request: r}]});
    expect(c.ok).toBe(false); expect(c.diagnostics[0]!.message).toMatch(/REVISION|PARAMETERS|TARGET/);
  }
  const duplicate = compileProduct(design, withTimeline(contract, [reset, {...reset, id: "again"}]));
  expect(duplicate.ok).toBe(false); expect(duplicate.diagnostics[0]!.message).toContain("OVERLAP");
  expect(compileProduct(design, withTimeline(contract, [reset, {...reset, id: "later", atUs: 2_000_001}])).ok).toBe(true);
  const {q, ledger} = quantities();
  compiled.input.networkInterventions.push({id: "saved", kind: "reset", target: "edge-1:app:db", at: q("saved", reset.atUs, "us")});
  compiled.input.ledger.push(...ledger); contract.interventions = [{id: reset.id, atUs: reset.atUs, request}];
  expect(() => compileInterventions(design, contract, compiled.input, derivedLedger(compiled.input.ledger))).toThrow("OVERLAP");
});

test("pool reset refuses endpoint replacement windows and rolls back a live refusal", () => {
  const {design, contract} = setup();
  const c = compileProduct(design, withTimeline(contract, [reset, {id: "crash", kind: "crash", atUs: 1_000_000, node: "app", durationUs: 2_000_000, restartUs: 1_000_000}]));
  expect(c.ok).toBe(false); expect(c.diagnostics[0]!.message).toContain("GENERATION");
  const run = createModel2Run(interventionInput(), 5), before = JSON.stringify(run.evidence());
  expect(() => run.apply(intervention("pool-reset", {}, {edgeId: "app-db", direction: "request"}))).toThrow("TARGET");
  expect(run.actions).toEqual([]); expect(JSON.stringify(run.evidence())).toBe(before);
  const applied = run.apply(intervention("pool-reset", {}, {edgeId: "app-db", direction: "both"}));
  expect(applied).toMatchObject({endSecond: 1, outcome: {intervention: {endUs: null}}});
  const logs = run.advance();
  expect(logs.some(l => l.message.includes("Reset connection pool applied") && l.message.includes("one-shot"))).toBe(true);
  expect(run.view().activeChaos).toEqual([]); advance(run, 1);
  expect(run.evidence().product.interventions).toMatchObject([{phase: "completed"}]);
});

test("reset evidence bounds identities and rows while preserving omitted and consequence counts", () => {
  const ids = resetIds(Array.from({length: 30}, (_,i) => `${i}${"界".repeat(100)}`));
  expect(ids).toEqual({ids: [], omitted: 30});
  const evidence = resetEvidence();
  for (let i = 0; i < 30; i++) {
    const row = {actionId: "reset", pathId: `p${i}`, atUs: 1, closedConnections: 10, failedStreams: 20,
      connections: ids, activeOwners: ids, reservedOwners: ids, waitingOwners: ids, freshOpens: {opened: 0, failed: 0, results: [], omitted: 0}};
    for (let j = 0; j < 100; j++) freshOpen(row, `c${j}`, "session-limit");
    evidence.add(row);
  }
  const e = evidence.measure();
  expect(e).toMatchObject({closedConnections: 300, failedStreams: 600, omitted: 14});
  expect(e.rows).toHaveLength(16); expect(e.rows[0]!.freshOpens).toMatchObject({failed: 100, omitted: 96});
  expect(new TextEncoder().encode(JSON.stringify(e)).length).toBeLessThanOrEqual(RESET_EVIDENCE_BYTES);
});
