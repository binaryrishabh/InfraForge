import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { challengeSeed, specHash } from "../challenges/registry";
import { buildRunReport } from "../reports/report";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "order-the-row-locks";
const d = definition(ID), STARTER = d.starter!, REF = REFERENCE[ID]!;
const edit = (base: ChallengeStarter, fn: (s: ChallengeStarter) => void) => { const s = structuredClone(base); fn(s); return s; };
const R = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const order = (o: "as-requested" | "by-key") => (s: ChallengeStarter) => { R(s, "db").rowLocking!.order = o; };
const rows = (count: number, accessPattern: "uniform" | "hot-key" = "uniform") => (s: ChallengeStarter) => { R(s, "db").dataKeyspace = { version: 1, count, accessPattern }; };
const sku = (id: string, v: string) => (s: ChallengeStarter) => { R(s, id).skuId = v; };
const size = (v: "small" | "medium" | "large") => (s: ChallengeStarter) => { R(s, "db").size = v; };
const all = (...fns: Array<(s: ChallengeStarter) => void>) => (s: ChallengeStarter) => fns.forEach(f => f(s));
const bigDb = edit(STARTER, size("large")), bigApp = edit(STARTER, sku("app", "m5.2xlarge")), rows40 = edit(STARTER, rows(40));
const two = (s: ChallengeStarter) => {
  const app = R(s, "app"); s.resources.push({ ...structuredClone(app), id: "app2", y: app.y + 168 }, { id: "lb", type: "Load Balancer", x: app.x - 256, y: app.y });
  s.connectionLines = [{ id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 }, { id: "lb-app2", sourceId: "lb", targetId: "app2", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 }, s.connectionLines[0]!, { ...s.connectionLines[0]!, id: "app2-db", sourceId: "app2" }];
};
const T = 600000;

const run = (design: ChallengeStarter, health = "degraded") => {
  const row = attemptRow(d, design, answers(d, { health })), report = buildRunReport(row), terminal = report.terminal!, db = terminal.resources.find(r => r.id === "db")!.database as unknown as Record<string, number | null | undefined>;
  return { row, report, status: report.challenge!.status, criteria: report.challenge!.criteria.map(c => c.status), completed: terminal.traffic!.wholeRun!.completed, failed: terminal.traffic!.wholeRun!.failed,
    deadlocks: db.deadlocks, waits: db.lockWaits, victims: db.deadlockVictims };
};
const line = (x: ReturnType<typeof run>) => [x.status, x.completed, x.failed, x.deadlocks, x.waits];

test("order-the-row-locks: ordering the locks by key removes the deadlocks; a bigger database, a bigger app and more rows do not; reports round-trip", () => {
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(new RegExp(`"${ID}@1": "([a-f0-9]{64})"`).exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  const designs = [STARTER, REF, bigDb, bigApp, rows40];
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const i of [1, 2, 3, 4]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({ classification: "one-change", count: 1 });
  for (const input of inputs) { expect(input.adapterProfiles).toContain("row-lock-order/1"); expect(JSON.stringify(buildContractFromRunInputs(input, 30))).toContain("product-arrivals/2"); } // both values marked, Poisson arrivals captured
  const r = designs.map(x => run(x));
  expect(r.map(x => x.status)).toEqual(["not-met", "met", "not-met", "not-met", "not-met"]);
  expect(r.map(x => x.criteria)).toEqual([["met", "not-met", "not-met"], ["met", "met", "met"], ["met", "not-met", "not-met"], ["met", "not-met", "not-met"], ["met", "not-met", "not-met"]]);
  // [status, completed, failed callers, deadlocks, lock waits]; the requirements are 14000 completed, no unsuccessful caller and no deadlock.
  expect(r.map(line)).toEqual(EXPECT.calibration);
  for (const x of r) { expect(x.victims).toBe(x.deadlocks); expect(x.failed).toBe(x.deadlocks as number); } // every failed caller is exactly one deadlock victim, counted once
  expect(r[0]!.deadlocks!).toBeGreaterThan(400); expect(r[1]!.completed - 14000).toBeGreaterThan(1000);
  expect(r[1]!.waits!).toBeGreaterThan(5000); // ordering does not remove waiting, only cycles
  expect(r[2]!.deadlocks!).toBeGreaterThan(200); expect(r[2]!.deadlocks!).toBeLessThan(r[0]!.deadlocks!); // a bigger database halves the odds, it does not remove them
  for (const x of r) {
    const saved = { ...x.row, runInputs: JSON.parse(JSON.stringify(x.row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(x.row.terminalSnapshot)) };
    expect(buildRunReport(saved).terminal).toEqual(x.report.terminal); expect(buildRunReport(saved).challenge).toEqual(x.report.challenge);
  }
}, T);

test("order-the-row-locks: seeds. The starter fails and the reference passes on five seeds; the worst case of each is the margin", () => {
  const seeds = [challengeSeed(d), "seed-a", "seed-b", "seed-c", "seed-d"];
  const engine = (design: ChallengeStarter, seed: string) => {
    const model = createModel2Engine(captureRunInputs({ ...design, layoutVersion: 3 }, d.workload, seed), 30);
    for (let s = 0; s < 30; s++) model.advance();
    const e = model.evidence() as { counts: { completed: number; rejected: number }; data: { databases: Array<{ locks: { deadlocks: number } }> } };
    return { completed: e.counts.completed, failed: e.counts.rejected, deadlocks: e.data.databases[0]!.locks.deadlocks };
  };
  const table = Object.fromEntries(Object.entries({ starter: STARTER, reference: REF, bigDb, rows40 }).map(([name, design]) => [name, seeds.map(seed => engine(design, seed))]));
  console.info("order-the-row-locks-seeds", JSON.stringify(table));
  const worst = (name: string, key: "completed" | "deadlocks", pick: "min" | "max") => Math[pick](...table[name]!.map(x => x[key]));
  expect(worst("starter", "deadlocks", "min")).toBeGreaterThan(400); // five seeds, 439 to 500
  expect(worst("reference", "deadlocks", "max")).toBe(0);
  for (const x of table.reference!) expect(x.failed).toBe(0);
  expect(worst("reference", "completed", "min") - 14000).toBeGreaterThan(800); // the worst seed still completes more than 800 above the floor
  expect(worst("bigDb", "deadlocks", "min")).toBeGreaterThan(200); // a bigger database halves the starter's count on every seed, never removes it
  for (const i of seeds.keys()) expect(table.bigDb![i]!.deadlocks).toBeLessThan(table.starter![i]!.deadlocks);
  expect(worst("rows40", "deadlocks", "min")).toBeGreaterThan(15); // forty rows lower the odds a lot but still fail on every seed
  for (const x of table.starter!) expect(x.failed).toBe(x.deadlocks);
}, T);

const SWEEP: Record<string, (s: ChallengeStarter) => void> = {
  "by-key": order("by-key"), "by-key db small": all(order("by-key"), size("small")), "by-key db large": all(order("by-key"), size("large")),
  "by-key app c5.large": all(order("by-key"), sku("app", "c5.large")), "by-key app m5.2xlarge": all(order("by-key"), sku("app", "m5.2xlarge")),
  "by-key 40 rows": all(order("by-key"), rows(40)), "by-key 2 rows": all(order("by-key"), rows(2)), "by-key hot-key": all(order("by-key"), rows(10, "hot-key")),
  "unmarked": s => { delete R(s, "db").rowLocking; },
  "db small": size("small"), "db large": size("large"), "db.m5.large": sku("db", "db.m5.large"), "db.m5.xlarge": sku("db", "db.m5.xlarge"), "db.m5.2xlarge": sku("db", "db.m5.2xlarge"), "db.t3.micro": sku("db", "db.t3.micro"),
  "app c5.large": sku("app", "c5.large"), "app m5.xlarge": sku("app", "m5.xlarge"), "app m5.2xlarge": sku("app", "m5.2xlarge"), "app m5.2xlarge + db large": all(sku("app", "m5.2xlarge"), size("large")),
  "2 rows": rows(2), "5 rows": rows(5), "20 rows": rows(20), "40 rows": rows(40), "100 rows": rows(100), "200 rows": rows(200), "400 rows": rows(400), "1000 rows": rows(1000), "as-requested hot-key": rows(10, "hot-key"),
  "40 rows + db large": all(rows(40), size("large")), "40 rows + app m5.2xlarge": all(rows(40), sku("app", "m5.2xlarge")),
  "active queries 1": s => { R(s, "db").dbConcurrency = { version: 1, activeQueries: 1 }; }, "active queries 2": s => { R(s, "db").dbConcurrency = { version: 1, activeQueries: 2 }; },
  "active queries 4": s => { R(s, "db").dbConcurrency = { version: 1, activeQueries: 4 }; }, "active queries 16": s => { R(s, "db").dbConcurrency = { version: 1, activeQueries: 16 }; },
  "queued queries 0": s => { R(s, "db").dbConcurrency = { version: 1, queuedQueries: 0 }; }, "two apps behind a balancer": two, "two apps behind a balancer by-key": all(two, order("by-key")),
  "pool 1": s => { R(s, "db").dbPoolMaxConnections = 1; }, "pool 2": s => { R(s, "db").dbPoolMaxConnections = 2; }, "pool 5": s => { R(s, "db").dbPoolMaxConnections = 5; }, "pool 20": s => { R(s, "db").dbPoolMaxConnections = 20; },
};

test("order-the-row-locks: forty plausible edits. Only a fixed order (or so many rows that no cycle forms) passes; every sentence in the lab is checked against these runs", () => {
  expect(Object.keys(SWEEP).length).toBeGreaterThanOrEqual(40);
  const out: Record<string, unknown[]> = {};
  for (const [name, fn] of Object.entries(SWEEP)) { const x = run(edit(STARTER, fn)); out[name] = [...line(x), x.criteria.join(",")]; }
  console.info("order-the-row-locks-sweep", JSON.stringify(out));
  expect(out).toEqual(EXPECT.sweep);
}, T);

test("order-the-row-locks: an unmarked database keeps one-row writes and no lock evidence; marked values are strictly validated", () => {
  const unmarked = edit(STARTER, s => { delete R(s, "db").rowLocking; });
  const input = captureRunInputs(unmarked, d.workload, challengeSeed(d));
  expect(input.adapterProfiles ?? []).not.toContain("row-lock-order/1");
  const contract = JSON.stringify(buildContractFromRunInputs(input, 30));
  expect(contract).not.toContain("rowLocking"); expect(contract).not.toContain("$key2"); expect(contract).not.toContain("row-lock-order");
  const marked = JSON.stringify(buildContractFromRunInputs(captureRunInputs(STARTER, d.workload, challengeSeed(d)), 30));
  expect(marked).toContain("\"rowLocking\":{\"order\":\"as-requested\"}"); expect(marked).toContain("$key2");
  const x = run(unmarked); // single-row writes cannot form a cycle, and with no saved order nothing is recorded
  expect(x.failed).toBe(0); expect(x.deadlocks).toBeUndefined(); expect(x.criteria).toEqual(["met", "met", "not-evaluated"]); expect(x.status).toBe("not-evaluated");
  for (const bad of ["yes", 0, null, [], {}, { version: 1, order: "by-key" }, { version: 1, rowsPerWrite: 3, order: "by-key" }, { version: 1, rowsPerWrite: 2, order: "random" }, { version: 1, rowsPerWrite: 2, order: "by-key", extra: 1 }]) expect(() => captureRunInputs(edit(STARTER, s => { R(s, "db").rowLocking = bad as never; }), d.workload, "x")).toThrow();
  expect(() => captureRunInputs(edit(STARTER, rows(1)), d.workload, "x")).toThrow(); // a saved order needs two or more rows
});

test("order-the-row-locks: a replicated database, a cache in front and a stripped profile are refused, never guessed", () => {
  const replicated = edit(STARTER, s => { R(s, "db").databaseReplication = { version: 1, enabled: true, replicationDelayMs: 100, readPolicy: "primary" }; });
  expect(preflight(d, replicated).errors.join(" ")).toContain("without replication or read routing");
  const cached = edit(STARTER, s => { s.resources.push({ id: "cache", type: "Cache", x: 300, y: 300 }); s.connectionLines.push({ id: "app-cache", sourceId: "app", targetId: "cache", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 }); });
  expect(preflight(d, cached).errors.join(" ")).toContain("plain app-to-database writes");
  const input = JSON.parse(JSON.stringify(captureRunInputs(STARTER, d.workload, "x")));
  input.adapterProfiles = input.adapterProfiles.filter((p: string) => p !== "row-lock-order/1");
  expect(() => createModel2Engine(readRunInputs(input), 30)).toThrow("row-lock-order");
});

test("order-the-row-locks: missing, malformed or contradictory evidence is never met", () => {
  const ref = run(REF), row = ref.row as unknown as { terminalSnapshot: { metrics: Record<string, { database: Record<string, unknown> }> }; runInputs: { resources: Array<{ id: string; rowLocking?: Record<string, unknown> }> } };
  const verdict = (patch: (db: Record<string, unknown>) => void, inputs?: (r: typeof row.runInputs) => void) => {
    const terminal = JSON.parse(JSON.stringify(row.terminalSnapshot)), runInputs = JSON.parse(JSON.stringify(row.runInputs));
    patch(terminal.metrics.db!.database); inputs?.(runInputs);
    return buildRunReport({ ...(ref.row as object), terminalSnapshot: terminal, runInputs } as never).challenge!.criteria[2]!.status;
  };
  expect(verdict(() => {})).toBe("met");
  expect(verdict(db => { delete db.deadlocks; })).toBe("not-evaluated");
  expect(verdict(db => { db.deadlocks = null; })).toBe("not-evaluated"); // Unknown is never zero
  expect(verdict(db => { db.deadlocks = -1; })).toBe("not-evaluated");
  expect(verdict(db => { db.deadlocks = 1.5; })).toBe("not-evaluated");
  expect(verdict(db => { delete db.lockWaits; })).toBe("not-evaluated");
  expect(verdict(db => { db.lockWaits = null; })).toBe("not-evaluated");
  expect(verdict(db => { delete db.deadlockVictims; })).toBe("not-evaluated");
  expect(verdict(db => { db.deadlocks = 2; db.deadlockVictims = 1; db.lockWaits = 9; })).toBe("not-evaluated"); // each deadlock ends exactly one victim
  expect(verdict(db => { db.deadlocks = 5; db.deadlockVictims = 5; db.lockWaits = 4; })).toBe("not-evaluated"); // a deadlock is first a wait
  expect(verdict(db => { db.deadlocks = 1; db.deadlockVictims = 1; db.lockWaits = 9; })).toBe("not-met");
  expect(verdict(() => {}, r => { delete r.resources.find(x => x.id === "db")!.rowLocking; })).toBe("not-evaluated"); // the saved order must be retained
  expect(verdict(() => {}, r => { r.resources = r.resources.filter(x => x.id !== "db"); })).toBe("not-evaluated");
  expect(verdict(() => {}, r => { r.resources.find(x => x.id === "db")!.rowLocking = { version: 1, rowsPerWrite: 2, order: "bogus" }; })).toBe("not-evaluated");
});

test("order-the-row-locks: lesson, module, review record and reviewed hash are registered; the lesson does not overclaim", async () => {
  const { findLearningLesson, LEARNING_REGISTRY } = await import("../learning/registry");
  const { learningContent } = await import("../learning/content"), { validateLearningContent } = await import("../learning/validate");
  const { checkLessonClaims } = await import("../learning/claims"), { REVIEWED_CHALLENGES } = await import("../learning/reviewedChallenges");
  const lesson = findLearningLesson(ID)!;
  expect(lesson).toMatchObject({ kind: "executable-lab", trackId: "data", moduleId: "transaction-locking", experiment: { challengeId: ID }, check: null, prerequisites: ["database-read-and-write", "writes-cost-more-than-reads", "diagnose-query-admission"] });
  expect(LEARNING_REGISTRY.findModule("data", "transaction-locking")!.lessonIds).toEqual([ID]);
  expect(REVIEWED_CHALLENGES[`${ID}@1`]).toEqual({ challengeId: ID, version: 1, hash: specHash(d) });
  expect(validateLearningContent(learningContent)).toEqual([]); expect(checkLessonClaims(lesson, d)).toEqual([]);
  const limits = lesson.limitations.join(" "), explanation = lesson.explanation.join(" ");
  expect(limits).toContain("no claim about any specific database product"); expect(limits).toContain("refused"); expect(explanation).toContain("Valid alternatives exist");
  expect(explanation).toContain("impossible"); expect(explanation).toContain("with four hundred rows one or none do"); expect(explanation).toContain("only one transaction at a time"); expect(limits).not.toMatch(/guarantee|always correct/i);
});

test("order-the-row-locks: with one transaction at a time the deadlocks go, but callers fail at the app while the database queue stays empty; the lesson names that place", async () => {
  const { findLearningLesson } = await import("../learning/registry");
  for (const queued of [undefined, 1000]) {
    const x = run(edit(STARTER, s => { R(s, "db").dbConcurrency = { version: 1, activeQueries: 1, ...(queued === undefined ? {} : { queuedQueries: queued }) }; }));
    const db = x.report.terminal!.resources.find(r => r.id === "db")!.database as unknown as Record<string, number | null>;
    expect(x.deadlocks).toBe(0); expect(x.failed).toBeGreaterThan(4000); expect(x.status).toBe("not-met");
    expect(db.rejected).toBe(0); expect(db["query-queue-full"] ?? 0).toBe(0); // the database queue refused nobody, even a 256 or 1000 deep one
  }
  const explanation = findLearningLesson(ID)!.explanation.join(" ");
  expect(explanation).toContain("only one transaction at a time"); expect(explanation).not.toContain("the queue fails callers");
  expect(explanation).toMatch(/app[^.]*(turns|fails|rejects)[^.]*callers/); // the app is where the overflow is refused
}, T);

test("order-the-row-locks: browser-target bundle and default server replay agree every second for starter, reference and a near miss", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/order-the-row-locks-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", out], { stdout: "ignore", stderr: "pipe" });
    const diagnostic = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostic);
    const module = await import(pathToFileURL(out).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    for (const design of [STARTER, REF, bigDb]) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design, d.workload, challengeSeed(d)))));
      expect(browserContract(input, 30)).toEqual(buildContractFromRunInputs(input, 30));
      const browser = browserRun(input, 30), server = createModel2Engine(input, 30);
      for (let second = 1; second <= 30; second++) { browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence()); }
    }
    console.info("order-the-row-locks-browser-target-server-parity", JSON.stringify({ cases: 3, secondsPerCase: 30 }));
  } finally { for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path); }
}, T);

// Filled from the committed real-engine runs above (the tests print the same tables with console.info).
const EXPECT = {
  calibration: [["not-met", 14637, 439, 439, 9703], ["met", 15076, 0, 0, 8847], ["not-met", 14848, 228, 228, 6443], ["not-met", 14651, 425, 425, 9755], ["not-met", 15054, 22, 22, 3036]] as any[],
  sweep: {
    "by-key": ["met", 15076, 0, 0, 8847, "met,met,met"],
    "by-key db small": ["not-met", 9995, 4817, 0, 9916, "met,not-met,met"],
    "by-key db large": ["met", 15076, 0, 0, 6284, "met,met,met"],
    "by-key app c5.large": ["not-met", 9994, 4824, 0, 1519, "met,not-met,met"],
    "by-key app m5.2xlarge": ["met", 15076, 0, 0, 8882, "met,met,met"],
    "by-key 40 rows": ["met", 15076, 0, 0, 2933, "met,met,met"],
    "by-key 2 rows": ["not-met", 9996, 4814, 0, 10004, "met,not-met,met"],
    "by-key hot-key": ["not-met", 11977, 2838, 0, 10415, "met,not-met,met"],
    "unmarked": ["not-evaluated", 15076, 0, undefined, undefined, "met,met,not-evaluated"],
    "db small": ["not-met", 9270, 5541, 1084, 13231, "met,not-met,not-met"],
    "db large": ["not-met", 14848, 228, 228, 6443, "met,not-met,not-met"],
    "db.m5.large": ["not-met", 14637, 439, 439, 9703, "met,not-met,not-met"],
    "db.m5.xlarge": ["not-met", 14848, 228, 228, 6443, "met,not-met,not-met"],
    "db.m5.2xlarge": ["not-met", 14850, 226, 226, 6410, "met,not-met,not-met"],
    "db.t3.micro": ["not-met", 14637, 439, 439, 9703, "met,not-met,not-met"],
    "app c5.large": ["not-met", 9953, 4866, 41, 1814, "met,not-met,not-met"],
    "app m5.xlarge": ["not-met", 14637, 439, 439, 9703, "met,not-met,not-met"],
    "app m5.2xlarge": ["not-met", 14651, 425, 425, 9755, "met,not-met,not-met"],
    "app m5.2xlarge + db large": ["not-met", 14859, 217, 217, 6551, "met,not-met,not-met"],
    "2 rows": ["not-met", 7819, 7253, 7253, 24857, "met,not-met,not-met"],
    "5 rows": ["not-met", 12677, 2399, 2399, 17096, "met,not-met,not-met"],
    "20 rows": ["not-met", 14992, 84, 84, 5455, "met,not-met,not-met"],
    "40 rows": ["not-met", 15054, 22, 22, 3036, "met,not-met,not-met"],
    "100 rows": ["not-met", 15073, 3, 3, 1280, "met,not-met,not-met"],
    "200 rows": ["not-met", 15074, 2, 2, 662, "met,not-met,not-met"],
    "400 rows": ["met", 15076, 0, 0, 296, "met,met,met"],
    "1000 rows": ["met", 15076, 0, 0, 144, "met,met,met"],
    "as-requested hot-key": ["not-met", 11992, 2825, 287, 11082, "met,not-met,not-met"],
    "40 rows + db large": ["not-met", 15067, 9, 9, 1569, "met,not-met,not-met"],
    "40 rows + app m5.2xlarge": ["not-met", 15055, 21, 21, 3028, "met,not-met,not-met"],
    "active queries 1": ["not-met", 9996, 4814, 0, 0, "met,not-met,met"],
    "active queries 2": ["not-met", 14980, 96, 96, 3917, "met,not-met,not-met"],
    "active queries 4": ["not-met", 14860, 216, 216, 7629, "met,not-met,not-met"],
    "active queries 16": ["not-met", 14637, 439, 439, 9703, "met,not-met,not-met"],
    "queued queries 0": ["not-met", 14637, 439, 439, 9703, "met,not-met,not-met"],
    "two apps behind a balancer": ["not-met", 14618, 458, 458, 9838, "met,not-met,not-met"],
    "two apps behind a balancer by-key": ["met", 15076, 0, 0, 8917, "met,met,met"],
    "pool 1": ["not-met", 9319, 5491, 0, 0, "met,not-met,met"],
    "pool 2": ["not-met", 14978, 98, 98, 3649, "met,not-met,not-met"],
    "pool 5": ["not-met", 14785, 291, 291, 8326, "met,not-met,not-met"],
    "pool 20": ["not-met", 14628, 448, 448, 9747, "met,not-met,not-met"],
  } as Record<string, any[]>,
};
