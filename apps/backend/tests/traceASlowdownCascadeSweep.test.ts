import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { captureRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { challengeSeed } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { buildRunReport } from "../reports/report";
import { answers, attemptRow, definition } from "./challengeHarness";

// An alternative is an observed passing design, not a claim that every untested
// value fails. Changes to the data demand are included and identified separately.
test("trace-a-slowdown-cascade: sweep 48 plausible edits and name every passing alternative", () => {
  const d = definition("trace-a-slowdown-cascade");
  const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
  const edits: Array<[string, (s: ChallengeStarter) => void]> = [];
  const add = (name: string, edit: (s: ChallengeStarter) => void) => edits.push([name, edit]);
  for (const n of [2, 4, 8, 12, 14, 15, 16, 24, 32, 64]) add(`cache-capacity-${n}`, s => {
    const cache = resource(s, "cache"); cache.cachePolicy = { ...cache.cachePolicy, version: 2, capacityEntries: n };
  });
  for (const n of [1, 5, 30, 120, 300, 3600]) add(`cache-ttl-${n}`, s => { resource(s, "cache").cachePolicy!.ttlSeconds = n; });
  add("single-flight-off", s => { resource(s, "cache").cachePolicy!.singleFlight = false; });
  for (const n of [1, 2, 3, 5]) add(`max-attempts-${n}`, s => { resource(s, "lb").retry!.maxAttempts = n; });
  for (const n of [1, 4, 16]) add(`retry-budget-${n}`, s => { resource(s, "lb").retry!.maxConcurrentRetries = n; });
  for (const n of [10, 100, 500]) add(`retry-backoff-${n}`, s => { resource(s, "lb").retry!.backoffMs = n; });
  for (const n of [32, 64, 128]) add(`app-workers-${n}`, s => { resource(s, "app").vmExecution!.workers = n; });
  for (const n of [128, 512]) add(`app-queue-${n}`, s => { resource(s, "app").vmExecution!.queuedRequests = n; });
  for (const n of ["medium", "large"] as const) add(`db-size-${n}`, s => { resource(s, "db").size = n; });
  for (const n of [1, 32, 100]) add(`db-pool-${n}`, s => { resource(s, "db").dbPoolMaxConnections = n; });
  for (const n of [32, 128]) add(`db-active-${n}`, s => { resource(s, "db").dbConcurrency = {version: 1, activeQueries: n}; });
  add("cache-size-large", s => { resource(s, "cache").size = "large"; });
  add("stale-60", s => { resource(s, "cache").cachePolicy!.staleSeconds = 60; });
  add("hot-key-access", s => { resource(s, "db").dataKeyspace!.accessPattern = "hot-key"; });
  for (const n of [1, 2, 4, 8]) add(`narrow-keyspace-${n}`, s => { resource(s, "db").dataKeyspace!.count = n; });
  for (const id of ["lb", "cache"]) add(`remove-${id}`, s => {
    s.resources = s.resources.filter(r => r.id !== id);
    s.connectionLines = s.connectionLines.filter(e => e.sourceId !== id && e.targetId !== id);
  });
  expect(edits).toHaveLength(48);
  const original = captureRunInputs(d.starter!, d.workload, challengeSeed(d));
  const measured: Array<{name: string; status: string; completed: number; failed: number; inFlight: number; classification: string}> = [];
  for (const [name, edit] of edits) {
    const design = structuredClone(d.starter!); edit(design);
    expect(preflight(d, design).errors, name).toEqual([]);
    const row = attemptRow(d, design, answers(d, {health: "healthy", database: "healthy", where: "app"}));
    const report = buildRunReport(row), whole = report.terminal!.traffic!.wholeRun!;
    const review = reviewDesignChanges(original, captureRunInputs(design, d.workload, challengeSeed(d)));
    expect(review.classification, name).toBe(name.startsWith("remove-") ? "several-changes" : "one-change");
    measured.push({name, status: report.challenge!.status, completed: whole.completed, failed: whole.failed, inFlight: whole.inFlight, classification: review.classification});
  }
  console.info("cascade-alternative-sweep", JSON.stringify(measured));
  expect(measured.filter(r => r.status === "met").map(r => r.name)).toEqual([
    "cache-capacity-14", "cache-capacity-15", "cache-capacity-16", "cache-capacity-24", "cache-capacity-32", "cache-capacity-64", "narrow-keyspace-1",
  ]);
  expect(measured.every(r => r.status === "met" || r.status === "not-met")).toBe(true);
  expect(measured.find(r => r.name === "cache-capacity-12")).toMatchObject({completed: 1848, failed: 151});
  expect(measured.find(r => r.name === "cache-ttl-5")).toMatchObject({status: "not-met", failed: 309});
  expect(measured.find(r => r.name === "max-attempts-1")).toMatchObject({failed: 365});
}, 480000);
