import { expect, test } from "bun:test";
import { design, prepare } from "./asyncCanvas.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline, type TimedAction } from "../src/model2/product/timeline";
import { compileInterventions, interventionOptions } from "../src/model2/product/interventions";
import { derivedLedger } from "../src/model2/product/provenance";
import { quantities } from "./workloadFixture";

const outage = (id = "outage", atUs = 1_000_001, duration = 5, resourceId = "worker"): TimedAction => ({
  id, atUs, kind: "intervention", request: {interventionId: "consumer-outage", revision: 1, target: {resourceId}, parameters: {duration}},
});
function setup(actions: TimedAction[] = [outage()], poison?: number, lease = 30) {
  const saved = design(true, 3.5);
  saved.resources.find(r => r.id === "queue")!.asyncQueue!.visibilityTimeoutSeconds = lease;
  if (poison !== undefined) saved.resources.find(r => r.id === "worker")!.asyncWorker!.badJobPercent = poison;
  const base = withRunLength(prepare(saved).contract, 70, "async-proof");
  const contract = withTimeline(base, [...actions, {id: "stop", kind: "load", atUs: 10_000_001, fraction: 0}]);
  const compiled = compileProduct(saved, contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled));
  return {saved, base, contract, compiled: compiled.value, runtime: createProductModel2(compiled.value)};
}
const state = (r: ReturnType<typeof createProductModel2>) => {
  const e = r.evidence();
  return {q: e.asynchronous.brokers[0]!, w: e.asynchronous.workers[0]!, p: e.asynchronous.publishers[0]!};
};

test("consumer outage keeps uploads flowing, ages backlog, retains leased credit and eventually drains", () => {
  const {runtime: r} = setup(), control = setup([]).runtime;
  r.advanceTo(1_000_000); expect(state(r).w.available).toBe(true); expect(r.activeInterventions()).toEqual([]);
  r.advanceTo(1_000_001);
  expect(state(r).w).toMatchObject({available: false, lostOnCrash: 1, active: 0, creditOwnedLocally: 0});
  expect(state(r).q).toMatchObject({inFlight: 1}); expect(r.activeInterventions()).toHaveLength(1);
  r.advanceTo(3_000_000); const early = state(r);
  r.advanceTo(6_000_000); control.advanceTo(6_000_000); const during = state(r);
  expect(during.p.uploaded).toBe(21); expect(during.p.uploaded).toBe(state(control).p.uploaded);
  expect(during.q).toMatchObject({accepted: 21, ready: 17, inFlight: 1, acknowledged: 3, redelivered: 0, deadLettered: 0});
  expect(during.q.ready).toBeGreaterThan(early.q.ready);
  expect(during.q.oldestReadyAgeUs!).toBeGreaterThan(early.q.oldestReadyAgeUs!);
  expect(during.w.available).toBe(false);
  r.advanceTo(6_000_001); expect(state(r).w.available).toBe(true); expect(r.activeInterventions()).toEqual([]);
  r.advanceTo(15_000_000); expect(state(r).q).toMatchObject({acknowledged: 3, inFlight: 1});
  expect(state(r).w).toMatchObject({available: true, active: 0, creditOwnedLocally: 0});
  const leaseUntil = state(r).q.messages.find(m => m.delivery)!.delivery!.leaseUntil;
  r.advanceTo(leaseUntil - 1); expect(state(r).q.leaseExpired).toBe(0);
  r.advanceTo(leaseUntil); expect(state(r).q.leaseExpired).toBe(1);
  r.advanceTo(70_000_000); control.advanceTo(70_000_000); const final = state(r);
  expect(final.q).toMatchObject({accepted: 36, acknowledged: 36, ready: 0, inFlight: 0, oldestReadyAgeUs: null, redelivered: 1, leaseExpired: 1, deadLettered: 0, nacked: 0});
  expect(final.w).toMatchObject({available: true, lostOnCrash: 1, creditOwnedLocally: 0, active: 0, acknowledged: 36, effects: 36});
  expect(final.q.acknowledged).toBe(state(control).q.acknowledged);
});

test("adjacent consumer windows restore first and preserve the exact authored worker configuration", () => {
  const {runtime: r, compiled} = setup([outage("first", 1_000_001, 1), outage("second", 2_000_001, 1)]);
  const original = JSON.stringify(compiled.input.resources.find(r => r.id === "worker"));
  r.advanceTo(2_000_000); expect(state(r).w.available).toBe(false);
  r.advanceTo(2_000_001); expect(state(r).w.available).toBe(false);
  expect(r.activeInterventions().map(r => r.actionId)).toEqual(["second"]);
  r.advanceTo(3_000_000); expect(state(r).w.available).toBe(false);
  r.advanceTo(3_000_001); expect(state(r).w.available).toBe(true);
  expect(r.evidence().asyncConfiguration.find(r => r.id === "worker")).toEqual(JSON.parse(original));
  expect(state(r).w.lostOnCrash).toBe(1);
});

test("outage leaves poison retries and dead-letter policy unchanged after recovery", () => {
  const broken = setup([outage()], 100, 2).runtime, control = setup([], 100, 2).runtime;
  broken.advanceTo(70_000_000); control.advanceTo(70_000_000);
  const a = state(broken), b = state(control);
  expect(a.q).toMatchObject({accepted: 36, ready: 0, inFlight: 0, deadLettered: 36, discarded: 0, dlqOverflow: 0, acknowledged: 0});
  expect(a.q.deadLettered).toBe(b.q.deadLettered);
  expect(a.q.dlq.every(d => d.reason === "attempt-limit" && d.message.attempts === 3)).toBe(true);
  expect(a.w.effects).toBe(0); expect(a.q.leaseExpired).toBe(1);
});

test("only the fixed primary worker resolves; availability, pause and replacement overlaps are refused", () => {
  const a = setup([]), options = interventionOptions(a.saved, a.base, a.compiled.input).filter(o => o.interventionId === "consumer-outage");
  expect(options.map(o => o.target)).toEqual([{resourceId: "worker"}]);
  const check = (actions: TimedAction[]) => compileProduct(a.saved, withTimeline(a.base, actions));
  for (const id of ["app", "queue", "store", "worker2"]) expect(check([outage("bad", 1, 1, id)]).ok).toBe(false);
  expect(check([outage(), outage("duplicate", 2_000_000)]).ok).toBe(false);
  for (const atUs of [0, 2_000_000]) expect(check([outage(), {id: "crash", kind: "crash", node: "worker", atUs, durationUs: 2_000_000, restartUs: 1_000_000}]).ok).toBe(false);
  const q = quantities();
  for (const available of [true, false]) {
    const input = JSON.parse(JSON.stringify(a.compiled.input)) as typeof a.compiled.input;
    input.asyncInterventions.push({id: "saved", target: "worker", kind: "consumer-state", available, at: q.q("saved.at", 0, "us"), duration: q.q("saved.duration", 2_000_000, "us")});
    expect(() => compileInterventions(a.saved, withTimeline(a.base, [outage()]), input, derivedLedger(a.base.ledger))).toThrow("OVERLAP");
  }
  const input = JSON.parse(JSON.stringify(a.compiled.input)) as typeof a.compiled.input;
  input.networkInterventions.push({id: "pause", target: "worker", kind: "service-state", alive: true, ready: false, at: q.q("saved.at", 0, "us"), duration: q.q("saved.duration", 2_000_000, "us")});
  expect(() => compileInterventions(a.saved, withTimeline(a.base, [outage()]), input, derivedLedger(a.base.ledger))).toThrow("GENERATION");
  const controlled = JSON.parse(JSON.stringify(a.base)) as typeof a.base;
  controlled.nodes.worker!.controller = {} as NonNullable<typeof controlled.nodes.worker>["controller"];
  expect(interventionOptions(a.saved, controlled, a.compiled.input).filter(o => o.interventionId === "consumer-outage")).toEqual([]);
});
