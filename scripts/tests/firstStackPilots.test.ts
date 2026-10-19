import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSummary, distribution, population, textHash, validateSummary } from "../reality/first-stack-pilots/summary";
import { verifyPinned } from "../reality/first-stack-pilots/verify";

test("pilot text identity is independent of checkout line endings", () => {
  expect(textHash("one\r\ntwo\r\n")).toBe(textHash("one\ntwo\n"));
});
test("missing measurements remain Unknown and empirical quantiles retain sample count", () => {
  expect(distribution([])).toBeNull();
  expect(distribution([4, 1, 2, 3])).toEqual({ count: 4, mean: 2.5, min: 1, p50: 2, p95: 4, p99: 4, max: 4 });
});
test("generator loss, caller deadlines, server completion and censored work conserve separate populations", () => {
  const clients = [
    { id: "drop", outcome: "generator-drop", intendedUs: 0, actualSendUs: null, responseUs: null },
    { id: "timeout", outcome: "deadline", intendedUs: 0, actualSendUs: 10, responseUs: 100, deadlineUs: 100 },
    { id: "censored", outcome: "right-censored", intendedUs: 0, actualSendUs: 20, responseUs: null, deadlineUs: 100 },
    { id: "ok", outcome: "completed", intendedUs: 0, actualSendUs: 5, responseUs: 50, deadlineUs: 100 },
  ];
  const server = new Map([
    ["timeout", { outcome: "completed", receivedUs: 20, dispatchUs: 30, completedUs: 150, serverAfterDeadline: true, threadCpuUs: 20 }],
    ["ok", { outcome: "completed", receivedUs: 10, dispatchUs: 15, completedUs: 30, serverAfterDeadline: false, threadCpuUs: 10 }],
  ]);
  const p = population(clients, server, 1);
  expect(p.offered).toBe(4); expect(p.sent).toBe(3); expect(p.sentWithoutServer).toBe(1);
  expect(p.serverCompleted).toBe(2); expect(p.serverAfterDeadline).toBe(1); expect(p.cohortGoodputPerSecond).toBe(1);
  expect(p.completedLatencyFromIntendedUs?.count).toBe(1); expect(p.threadCpuUs?.count).toBe(2); expect(p.poolWaitUs).toBeNull();
});
test("duplicate roots cannot silently overwrite offered work", () => {
  expect(() => population([{ id: "x", outcome: "generator-drop", actualSendUs: null }, { id: "x", outcome: "generator-drop", actualSendUs: null }], new Map(), 1)).toThrow("Duplicate");
});
test("public timing promotion is rejected before inspecting a pilot record", () => {
  expect(() => validateSummary({ schema: "infraforge-g1-summary/1", scope: "local-semantic-pilot-only", timingPromotion: true, evidenceLabel: "supported-calibrated" })).toThrow("claim boundary");
});
test("setup failure produces Unknown measurements without inventing a completed campaign", async () => {
  const base = resolve(import.meta.dir, "../../.cache"); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(resolve(base, "pilot-test-"));
  try {
    const manifest = JSON.parse(readFileSync(new URL("../reality/first-stack-pilots/manifest.json", import.meta.url), "utf8"));
    const sourceHashes = Object.fromEntries(["app.ts", "worker.ts", "generator.ts", "telemetry.ts", "run.ts", "manifest.json"].map((name) => [name, textHash(readFileSync(new URL(`../reality/first-stack-pilots/${name}`, import.meta.url), "utf8"))]));
    writeFileSync(resolve(dir, "campaign.json"), JSON.stringify({ manifest, sourceHashes, windows: [], failures: [{ reason: "authored startup failure fixture" }], endedAt: "2000-01-01T00:00:00.000Z" }));
    const s = await buildSummary(dir); validateSummary(s);
    expect(s.appEnvironment).toBeNull(); expect(s.reconciliation).toBeNull(); expect(s.demandCandidate.threadCpuUs).toBeNull();
    expect(s.windows).toEqual([]); expect(s.failures).toHaveLength(1);
    const corrupt = structuredClone(s); corrupt.missingCounters.perQueryDbCpu = 0 as never;
    expect(() => validateSummary(corrupt)).toThrow("Unknown");
  } finally { if (!dir.startsWith(base + "/") && !dir.startsWith(base + "\\")) throw Error("Temporary path escaped workspace cache"); rmSync(dir, { recursive: true, force: true }); }
});
test("retained G1 evidence verifies without Docker and rejects changed populations or holdout membership", () => {
  const summary = verifyPinned(resolve(import.meta.dir, "../../docs/reality/g1-local-pilot.json"));
  expect(summary.windows.filter((w: any) => w.status === "complete")).toHaveLength(31);
  expect(summary.priorAttempts).toHaveLength(5);
  const lost = structuredClone(summary); lost.windows[0].observed.offered++;
  expect(() => validateSummary(lost)).toThrow("Population conservation");
  const contaminated = structuredClone(summary);
  contaminated.windows.find((w: any) => w.split === "holdout").split = "exploratory";
  expect(() => validateSummary(contaminated)).toThrow("Holdout contamination");
  const timing = structuredClone(summary); timing.timingPromotion = true;
  expect(() => validateSummary(timing)).toThrow("claim boundary");
});
