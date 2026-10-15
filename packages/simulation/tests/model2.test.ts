import { expect, test } from "bun:test";
import { createModel2 } from "../src/model2/run";
import { EventKernel, micros } from "../src/model2/time";
import { keyedUniform, philox } from "../src/model2/random";
import { resolveModel, ACTIVE_MODEL_VERSION } from "../src/model2/registry";
import { tick } from "../src/engine";
import { SIMULATION_MODEL_VERSION } from "../src/tuning";
import { proofInput, setProofValue } from "./model2Fixture";
import { exploreProof, propertyProof } from "./model2Exploration";
import { validateLedger } from "../src/reality/ledger";
import { FOUNDATION_LEDGER } from "../src/model2/provenance";

function run(input = proofInput(), speed = 1) {
  const model = createModel2(input);
  for (let at = 0; at < model.horizon; at += speed * 100000) model.advanceTo(Math.min(model.horizon, at + speed * 100000));
  return model.evidence();
}
test("only Model 1 is published; Model 2 dispatch is explicit and unknown models are rejected", () => {
  expect(ACTIVE_MODEL_VERSION).toBe("1"); expect(SIMULATION_MODEL_VERSION).toBe("1");
  const legacy = resolveModel("1"); expect(legacy.version).toBe("1");
  if (legacy.version === "1") expect(legacy.tick).toBe(tick);
  expect(() => resolveModel("2")).toThrow("internal"); expect(resolveModel("2", { internal: true }).version).toBe("2");
  expect(() => resolveModel("3", { internal: true })).toThrow("Unsupported");
});
test("integer event time, stable ties, exact horizons and execution budgets", () => {
  const k = new EventKernel(10), order: string[] = [];
  k.schedule(2, 0, "b", () => order.push("b")); k.schedule(2, 0, "a", () => order.push("a"));
  k.schedule(2, -1, "end", () => order.push("end")); k.advanceTo(1); expect(order).toEqual([]);
  k.advanceTo(2); expect(order).toEqual(["end", "a", "b"]); expect(k.now).toBe(micros(2));
  expect(() => k.advanceTo(1)).toThrow(); expect(() => micros(0.5)).toThrow(); expect(() => micros(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  const small = new EventKernel(1); small.schedule(1, 0, "x", () => {}); expect(() => small.schedule(1, 0, "y", () => {})).toThrow("budget");
});
test("Philox matches three published Random123 vectors; keyed streams have no iteration coupling", () => {
  expect(philox([0, 0, 0, 0], [0, 0])).toEqual([0x6627e8d5, 0xe169c58d, 0xbc57ac4c, 0x9b00dbd8]);
  expect(philox([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff], [0xffffffff, 0xffffffff])).toEqual([0x408f276d, 0x41c83b0e, 0xa20bc7c6, 0x6d5451fd]);
  expect(philox([0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344], [0xa4093822, 0x299f31d0])).toEqual([0xd16cfe09, 0x94fdcceb, 0x5001e420, 0x24126ea1]);
  const streams = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, Array.from({ length: 50 }, (_, n) => keyedUniform("s", id, String(n), "demand"))]));
  const first = streams(["a", "b"]), reordered = streams(["unrelated", "b", "a"]);
  expect(first.a).toEqual(reordered.a); expect(first.b).toEqual(reordered.b); expect(first.a).not.toEqual(first.b);
  expect(() => keyedUniform("s", "r", "e", "p", -1)).toThrow();
});
test("vertical proof propagates paused DB service into held app concurrency, queues and rejection; state drains after expiry", () => {
  const evidence = run(), at = (time: number) => evidence.samples.find((s) => s.at === time)!;
  const before = at(150000), during = at(400000), after = at(2000000);
  expect(before.resources.find((r) => r.id === "app")!.queued).toBe(0);
  expect(during.resources.find((r) => r.id === "db")!.status).toBe("unavailable");
  expect(during.resources.find((r) => r.id === "app")!.waitingOnDependency).toBe(4);
  expect(during.resources.find((r) => r.id === "app")!.queued).toBe(16);
  expect(during.failed).toBeGreaterThan(0);
  expect(during.resources.find((r) => r.id === "db")!.cpuConsumedUs).toBe(at(200000).resources.find((r) => r.id === "db")!.cpuConsumedUs);
  expect(at(500000).inFlight).toBeGreaterThan(0);
  expect(after.inFlight).toBe(0); expect(after.resources.every((r) => r.queued === 0 && r.active === 0 && r.status === "healthy")).toBe(true);
  expect(evidence.faults).toEqual([{ id: "db-pause", at: 200000, state: "applied" }, { id: "db-pause", at: 500000, state: "ended" }]);
  expect(evidence.results.length).toBe(100); expect(evidence.cost.kind).toBe("unknown");
  expect(after.resources.every((r) => r.memoryBytes.kind === "unknown")).toBe(true);
  for (const resource of after.resources) expect(resource.cpuConsumedUs).toBeGreaterThan(0);
});
test("repeat, playback batches and topology ordering yield identical evidence; removing fault improves this scenario", () => {
  const input = proofInput(), expected = run(input);
  for (const speed of [1, 10, 60]) expect(run(input, speed)).toEqual(expected);
  const reordered = proofInput(); reordered.resources.reverse(); expect(JSON.stringify(run(reordered))).toBe(JSON.stringify(expected));
  const noFault = proofInput(); noFault.faults = []; expect(run(noFault).results.filter((r) => r.outcome === "completed").length).toBe(100);
  expect(expected.results.filter((r) => r.outcome === "completed").length).toBeLessThan(100);
});
test("synthetic sensitivity corpus conserves work/capacity and has a pinned deterministic result", () => {
  const corpus = exploreProof(); expect(corpus.cases).toBe(81);
  expect(corpus.digest).toBe("b79a414862f17e7540d49af46161fa56ca5a0b0e6ac98ced827da02f4f684a84");
});
test("deadline at exact completion wins according to the explicit tie policy", () => {
  const input = proofInput(); input.faults = []; setProofValue(input, "proof.timeout", 24000);
  expect(run(input).results.find((r) => r.id === "read/0")!.outcome).toBe("timed-out");
});
test("generated service/queue/deadline cases preserve capacity and work conservation", () => {
  expect(propertyProof()).toEqual({ cases: 1000, digest: "b1597b117bc23de160e855fbdf521c05ff97e4683dff4831e419d60760b11f47" });
  expect(validateLedger(FOUNDATION_LEDGER)).toEqual([]);
});
test("analytical no-fault CPU accounting and conservation; timeout preserves bounded state", () => {
  const input = proofInput(); input.faults = [];
  const final = run(input).samples.at(-1)!;
  expect(final.completed).toBe(100); expect(final.failed).toBe(0); expect(final.inFlight).toBe(0);
  expect(final.resources.find((r) => r.id === "app")!.cpuConsumedUs).toBe(200000);
  expect(final.resources.find((r) => r.id === "db")!.cpuConsumedUs).toBe(500000);
  const timed = proofInput(); setProofValue(timed, "proof.timeout", 50000);
  const out = run(timed); expect(out.results.some((r) => r.outcome === "timed-out")).toBe(true);
  for (const s of out.samples) expect(s.completed + s.failed + s.inFlight).toBe(Math.min(100, Math.floor(s.at / 10000) + 1));
  expect(out.samples.at(-1)!.inFlight).toBe(0);
});
test("unsupported faults, cycles, unknown parameters, missing units/provenance and impossible budgets fail closed", () => {
  for (const change of [(p: ReturnType<typeof proofInput>) => { p.faults[0]!.target = "edge"; },
    (p: ReturnType<typeof proofInput>) => { p.resources[1] = { ...p.resources[1]!, kind: "router", backends: ["edge"] }; },
    (p: ReturnType<typeof proofInput>) => { p.horizon = { kind: "unknown", unit: "us", provenance: ["missing"], reason: "Not supplied" }; },
    (p: ReturnType<typeof proofInput>) => { p.horizon.provenance = []; },
    (p: ReturnType<typeof proofInput>) => { p.limits.maxSamples = 2; }]) {
    const p = proofInput(); change(p); expect(() => createModel2(p)).toThrow();
  }
  const p = proofInput(), model = createModel2(p); setProofValue(p, "proof.requests", 0); model.advanceTo(model.horizon);
  expect(model.evidence().results.length).toBe(100); expect(() => model.advanceTo(model.horizon + 1)).toThrow();
});
test("quantization does not invent CPU consumption; unrelated idle resources do not affect the work", () => {
  const input = proofInput(); setProofValue(input, "proof.app.cores", 3); input.faults = [];
  const result = run(input); expect(result.samples.at(-1)!.resources.find((r) => r.id === "app")!.cpuConsumedUs).toBeCloseTo(200000, 6);
  const extra = proofInput(), app = extra.resources.find((r) => r.kind === "compute")!;
  if (app.kind !== "router") extra.resources.push({ ...app, id: "unrelated", downstream: undefined });
  const expanded = run(extra), original = run(); expect(expanded.results).toEqual(original.results);
  expect(expanded.samples.map((s) => ({ ...s, resources: s.resources.filter((r) => r.id !== "unrelated") }))).toEqual(original.samples);
});
test("execution budget failure stays incomplete and cannot resume; adjacent interventions have exact end-before-start semantics", () => {
  const limited = proofInput(); limited.limits.maxEvents = 20;
  const model = createModel2(limited); expect(() => model.advanceTo(model.horizon)).toThrow("budget");
  expect(model.evidence().capture.complete).toBe(false); expect(model.evidence().capture.failure).toContain("budget");
  expect(() => model.advanceTo(model.horizon)).toThrow("no resume");
  const adjacent = proofInput(); adjacent.faults.push({ ...adjacent.faults[0]!, id: "a-next" });
  const at = adjacent.faults[1]!.at; adjacent.faults[1]!.at = { ...at, kind: "known", value: 500000, provenance: ["proof.timeout"] };
  const out = run(adjacent);
  expect(out.faults.filter((f) => f.at === 500000).map((f) => f.state)).toEqual(["ended", "applied"]);
});
