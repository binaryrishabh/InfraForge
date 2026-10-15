import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createModel2 } from "../src/model2/run";
import { proofInput, setProofValue } from "./model2Fixture";
import { keyedUniform } from "../src/model2/random";

export function exploreProof() {
  const rows = [];
  for (const queue of [0, 4, 16]) for (const connections of [1, 2, 4]) for (const pause of [0, 100000, 300000]) for (const demand of [2000, 5000, 10000]) {
    const input = proofInput(); setProofValue(input, "proof.app.queue", queue); setProofValue(input, "proof.db.connections", connections);
    setProofValue(input, "proof.db.cpu", demand); setProofValue(input, "proof.horizon", 4000000);
    if (!pause) input.faults = []; else setProofValue(input, "proof.fault.duration", pause);
    const model = createModel2(input); model.advanceTo(model.horizon); const out = model.evidence(), final = out.samples.at(-1)!;
    if (out.results.length !== 100 || final.inFlight !== 0 || !out.capture.complete || new Set(out.results.map((r) => r.id)).size !== 100) throw new Error("Work conservation/draining failed");
    for (const s of out.samples) for (const r of s.resources) {
      const maxQueue = r.id === "app" ? queue : 4, slots = r.id === "app" ? 4 : connections;
      if (r.queued > maxQueue || r.active > slots || r.cpuConsumedUs < 0 || r.cpuConsumedUs > s.at * (r.id === "app" ? 2 : 1) + 0.001) throw new Error("Capacity invariant failed");
    }
    rows.push({ queue, connections, pause, demand, completed: final.completed, failed: final.failed });
  }
  return { cases: rows.length, rows, digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}

export function performanceProof() {
  const input = proofInput(), app = input.resources.find((r) => r.id === "app")!, db = input.resources.find((r) => r.id === "db")!;
  if (app.kind === "router" || db.kind === "router") throw new Error("Invalid proof");
  input.resources = [{ id: "edge", kind: "router", backends: Array.from({ length: 64 }, (_, i) => `app-${i}`) },
    ...Array.from({ length: 64 }, (_, i) => [{ ...app, id: `app-${i}`, downstream: `db-${i}` }, { ...db, id: `db-${i}` }]).flat()];
  input.faults = []; setProofValue(input, "proof.requests", 10000); setProofValue(input, "proof.interval", 100); setProofValue(input, "proof.horizon", 3000000);
  input.limits.maxRequests = 20000; input.limits.maxEvents = 200000;
  const start = performance.now(), model = createModel2(input); model.advanceTo(model.horizon); const elapsedMs = performance.now() - start, out = model.evidence();
  if (out.results.length !== 10000 || out.samples.at(-1)!.inFlight !== 0 || !out.capture.complete) throw new Error("Performance proof incomplete");
  return { resources: input.resources.length, requests: out.results.length, samples: out.samples.length, elapsedMs: Math.round(elapsedMs * 100) / 100,
    events: out.execution.events, peakPending: out.execution.peakPending, evidenceBytes: Buffer.byteLength(JSON.stringify(out)) };
}
export function propertyProof(cases = 1000) {
  const rows = [];
  for (let i = 0; i < cases; i++) {
    const integer = (field: string, low: number, high: number) => low + Math.floor(keyedUniform("m2a-properties", String(i), "input", field) * (high - low + 1));
    const input = proofInput(), appSlots = integer("app.slots", 1, 8), dbSlots = integer("db.slots", 1, 8);
    const appQueue = integer("app.queue", 0, 32), dbQueue = integer("db.queue", 0, 16), interval = integer("interval", 1000, 20000);
    const cores = [0.5, 1, 2, 3][integer("cores", 0, 3)]!;
    for (const [id, value] of Object.entries({ "proof.requests": 20, "proof.app.cores": cores, "proof.app.workers": appSlots,
      "proof.db.connections": dbSlots, "proof.app.queue": appQueue, "proof.db.queue": dbQueue, "proof.interval": interval,
      "proof.timeout": integer("timeout", 20000, 500000), "proof.app.cpu": integer("app.cpu", 1, 10000),
      "proof.db.cpu": integer("db.cpu", 1, 10000), "proof.db.io": integer("db.io", 0, 20000), "proof.fault.duration": integer("pause", 1, 300000) })) setProofValue(input, id, value);
    if (i % 2) input.faults = [];
    const model = createModel2(input); model.advanceTo(model.horizon); const out = model.evidence(), final = out.samples.at(-1)!;
    if (out.results.length !== 20 || new Set(out.results.map((r) => r.id)).size !== 20 || final.inFlight !== 0 || !out.capture.complete) throw new Error(`Generated case ${i}: terminal conservation failed`);
    for (const s of out.samples) {
      if (s.completed + s.failed + s.inFlight !== Math.min(20, Math.floor(s.at / interval) + 1)) throw new Error(`Generated case ${i}: population conservation failed`);
      for (const r of s.resources) {
        if (r.active > (r.id === "app" ? appSlots : dbSlots) || r.queued > (r.id === "app" ? appQueue : dbQueue) || r.cpuConsumedUs < 0 || r.cpuConsumedUs > s.at * (r.id === "app" ? cores : 1) + 0.001) throw new Error(`Generated case ${i}: capacity violated`);
      }
    }
    rows.push([final.completed, final.failed]);
  }
  return { cases, digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}
if (import.meta.main) {
  const exploration = exploreProof();
  console.info(JSON.stringify({ calibration: { cases: exploration.cases, digest: exploration.digest,
    completedRange: [Math.min(...exploration.rows.map((r) => r.completed)), Math.max(...exploration.rows.map((r) => r.completed))] }, generatedProperties: propertyProof(), performance: performanceProof(),
    scope: "Synthetic analytical/sensitivity verification; no real-service calibration or performance guarantee" }, null, 2));
}
