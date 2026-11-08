import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { buildRunReport } from "../reports/report";
import { challengeSeed, specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { reviewDesignChanges } from "../challenges/designChanges";
import { captureRunInputs } from "../deployments/runInputs";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

test("size-the-app-database-pool: one pool change fixes callers with spare CPU; DB capacity near miss and missing evidence refuse success", () => {
 const d = definition("size-the-app-database-pool"), start = d.starter!, fixed = REFERENCE[d.id]!, near = structuredClone(start);
 near.resources.find(r => r.id === "db")!.skuId = "db.m5.xlarge";
 const restored = structuredClone(fixed); restored.resources.find(r => r.id === "db")!.dbPoolMaxConnections = 1;
 expect(restored).toEqual(start); expect(validateInfrastructureName(d.title)).toBeNull();
 const pins = readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8");
 const pin = /"size-the-app-database-pool@1": "([a-f0-9]{64})"/.exec(pins)![1]; expect(specHash(d)).toBe(pin!);
 const inputs = [start, fixed, near].map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
 expect(reviewDesignChanges(inputs[0]!, inputs[1]!)).toMatchObject({classification: "one-change", count: 1,
   differences: {reconfigured: [{id: "db", fields: [{field: "dbPoolMaxConnections", earlier: 1, later: 2}]}]}});
 for (const s of [start, fixed, near]) expect(preflight(d, s).errors).toEqual([]);
 const rows = [start, fixed, near].map(s => attemptRow(d, s, answers(d, {"database-health": "healthy"})));
 const reports = rows.map(row => buildRunReport(row));
 expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
 const metrics = reports.map(r => {
  const t = r.terminal!, path = t.durationEvidence!.paths.find(p => p.target === "db")!;
  return {status: r.challenge!.status, appCpu: t.resources.find(r => r.id === "app")!.cpu!, dbCpu: t.resources.find(r => r.id === "db")!.cpu!,
   p95: t.traffic!.latencyMs.p95!, whole: t.traffic!.wholeRun!, waitUs: path.reachedPhaseUs.connectionWaitUs!, pending: path.pendingAcquisitions,
   sessions: t.resources.find(r => r.id === "db")!.connections, sessionRefusals: t.resources.find(r => r.id === "db")!.database!.sessionRefused};
 });
 for (const m of metrics) { expect(m.appCpu).toBeLessThan(60); expect(m.dbCpu).toBeLessThan(60); expect(m.sessionRefusals).toBe(0); }
 expect(metrics[0]!.whole.failed).toBeGreaterThan(700); expect(metrics[0]!.p95).toBeGreaterThan(300); expect(metrics[0]!.waitUs).toBeGreaterThan(100_000_000);
 expect(metrics[0]!.pending).toBeGreaterThan(0); expect(metrics[0]!.sessions).toBe(1);
 expect(metrics[1]!.whole.completed).toBeGreaterThan(5900); expect(metrics[1]!.whole.failed).toBe(0); expect(metrics[1]!.p95).toBeLessThan(10);
 expect(metrics[1]!.pending).toBe(0); expect(metrics[1]!.sessions).toBe(2); expect(metrics[1]!.waitUs).toBeLessThan(1000);
 expect(metrics[2]!.whole).toEqual(metrics[0]!.whole); expect(metrics[2]!.dbCpu).toBeLessThan(metrics[0]!.dbCpu);
 for (const [i, row] of rows.entries()) {
  const saved = {...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))};
  expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal); expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
  expect(reports[i]!.challenge!.predictions[0]!.actual).toBe("healthy");
 }
 const raw = (row: typeof rows[number]) => row.terminalSnapshot as SimulationSnapshot & {durationEvidence?: unknown};
 for (const mutate of [
  (r: typeof rows[number]) => { r.terminalSnapshot = null; },
  (r: typeof rows[number]) => { raw(r).simulatedSeconds--; },
  (r: typeof rows[number]) => { delete raw(r).traffic!.wholeRun; },
  (r: typeof rows[number]) => { raw(r).traffic!.wholeRun!.throughSecond--; },
 ]) { const bad = structuredClone(rows[1]!); mutate(bad); expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated"); }
 const noTail = structuredClone(rows[1]!); raw(noTail).traffic!.latencyMs.p95 = null;
 expect(buildRunReport(noTail).challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-evaluated");
 const wrongHash = structuredClone(rows[1]!); wrongHash.challengeSpecHash = "0".repeat(64); expect(buildRunReport(wrongHash).challenge!.status).toBe("unavailable");
 const noDurations = structuredClone(rows[1]!); delete raw(noDurations).durationEvidence;
 expect(buildRunReport(noDurations).terminal!.durationEvidence).toBeUndefined();
 console.info("pool-lab-calibration", JSON.stringify(metrics));
}, 120000);
