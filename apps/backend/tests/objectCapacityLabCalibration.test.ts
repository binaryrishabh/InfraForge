import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { buildRunReport } from "../reports/report";
import { challengeSeed, specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { readPrediction } from "../challenges/prediction";
import { reviewDesignChanges } from "../challenges/designChanges";
import { captureRunInputs } from "../deployments/runInputs";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

test("object bytes versus app CPU: one byte-limit edit passes with headroom; a larger producer still refuses puts", () => {
  const d = definition("object-bytes-versus-app-cpu"), start = d.starter!, fixed = REFERENCE[d.id]!, near = structuredClone(start);
  near.resources.find(r => r.id === "app")!.size = "large";
  const restored = structuredClone(fixed); restored.resources.find(r => r.id === "store")!.objectStoragePolicy!.capacityMiB = 1;
  expect(restored).toEqual(start); expect(validateInfrastructureName(d.title)).toBeNull();
  const pin = /"object-bytes-versus-app-cpu@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1];
  expect(specHash(d)).toBe(pin!);
  const inputs = [start, fixed, near].map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  expect(reviewDesignChanges(inputs[0]!, inputs[1]!)).toMatchObject({classification: "one-change", count: 1,
    differences: {reconfigured: [{id: "store", fields: [{field: "objectStoragePolicy", earlier: {version: 1, capacityMiB: 1}, later: {version: 1, capacityMiB: 4}}]}]}});
  expect(reviewDesignChanges(inputs[0]!, inputs[2]!)).toMatchObject({classification: "one-change", count: 1});
  for (const s of [start, fixed, near]) expect(preflight(d, s).errors).toEqual([]);
  const types = start.resources.map(r => r.type);
  expect(() => readPrediction({answers: {}}, d, types)).toThrow("Answer every prediction");
  expect(() => readPrediction({answers: {health: "object-capacity"}}, d, types)).toThrow("offered answers");
  const prediction = readPrediction(answers(d, {"overall-health": "healthy"}), d, types);
  const rows = [start, fixed, near].map(s => attemptRow(d, s, prediction)), reports = rows.map(row => buildRunReport(row));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const metrics = reports.map(r => {
    const t = r.terminal!, store = t.resources.find(r => r.id === "store")!.objectStorage!, q = t.resources.find(r => r.id === "queue")!.queueWork!;
    return {appCpu: t.resources.find(r => r.id === "app")!.cpu!, health: t.health, store, whole: t.traffic!.wholeRun!, queue: q};
  });
  const [a, b, n] = metrics;
  for (const m of metrics) {
    expect(m.appCpu).toBeLessThan(20);
    expect(m.whole.deadlineExceeded + m.whole.abandoned + m.whole.inFlight).toBe(0);
    expect(m.store.replacedObjects).toBe(0); expect(m.store.removedObjects).toBe(0);
    expect(m.store.storedBytes).toBe(1024 + m.store.committedPuts! * 1024);
    expect(m.store.omittedObjects!).toBeGreaterThan(0); // Current inventory is bounded, not a full byte ledger.
    expect(m.queue.acknowledged).toBeLessThan(m.whole.completed);
    expect(m.queue.ready).toBeGreaterThan(0); expect(m.queue.inFlight).toBe(1);
  }
  expect(a!.appCpu).toBe(14.4); expect(b!.appCpu).toBe(a!.appCpu); expect(n!.appCpu).toBe(3.6);
  expect(a!.whole.completed).toBe(723); expect(a!.whole.failed).toBe(477);
  expect(a!.store).toMatchObject({storedBytes: 1048576, capacityBytes: 1048576, puts: 1699, committedPuts: 1023, "object-capacity": 676, commandReasons: {"object-capacity": 676}});
  expect(a!.store.puts! - a!.store.committedPuts!).toBe(a!.store["object-capacity"]!);
  expect(b!.whole.completed).toBe(1200); expect(b!.whole.failed).toBe(0);
  expect(b!.whole.completed - 1100).toBeGreaterThanOrEqual(100);
  expect(b!.store).toMatchObject({storedBytes: 1740800, capacityBytes: 4194304, puts: 1699, committedPuts: 1699, "object-capacity": null, commandReasons: {}});
  expect(b!.store.capacityBytes! - b!.store.storedBytes!).toBeGreaterThan(2 * 1024 * 1024);
  expect(n!.store).toEqual(a!.store); expect(n!.whole).toEqual(a!.whole); expect(n!.queue).toEqual(a!.queue);
  expect(b!.queue).toMatchObject({acknowledged: 499, ready: 700, inFlight: 1});
  for (const [i, row] of rows.entries()) {
    const saved = {...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))};
    expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal);
    expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
    expect(reports[i]!.challenge!.predictions[0]!.actual).toBe(metrics[i]!.health);
  }
  const raw = (row: typeof rows[number]) => row.terminalSnapshot as SimulationSnapshot;
  for (const mutate of [
    (r: typeof rows[number]) => { r.terminalSnapshot = null; },
    (r: typeof rows[number]) => { raw(r).simulatedSeconds--; },
    (r: typeof rows[number]) => { delete raw(r).traffic!.wholeRun; },
    (r: typeof rows[number]) => { raw(r).traffic!.wholeRun!.throughSecond--; },
    (r: typeof rows[number]) => { r.runInputs = null; },
  ]) {
    const bad = structuredClone(rows[1]!); mutate(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
  }
  const wrongHash = structuredClone(rows[1]!); wrongHash.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(wrongHash).challenge!.status).toBe("unavailable");
  const noObject = structuredClone(rows[1]!); delete raw(noObject).metrics.store!.objectStorage;
  expect(buildRunReport(noObject).terminal!.resources.find(r => r.id === "store")!.objectStorage).toBeUndefined();
  // Caller outcomes remain scoreable, but missing object evidence cannot prove the byte mechanism.
  expect(buildRunReport(noObject).challenge!.status).toBe("met");
  console.info("object-capacity-lab", JSON.stringify(metrics.map(m => ({cpu: m.appCpu, health: m.health, stored: m.store.storedBytes, capacity: m.store.capacityBytes,
    puts: m.store.puts, committed: m.store.committedPuts, refused: m.store["object-capacity"], completed: m.whole.completed, failed: m.whole.failed,
    acknowledged: m.queue.acknowledged, ready: m.queue.ready, inFlight: m.queue.inFlight}))));
}, 120000);
