import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { databaseReplicationError } from "@infraforge/domain/resource";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildContractFromRunInputs, compileProduct } from "@infraforge/simulation/internal-product";
import { buildRunReport } from "../reports/report";
import { readRunInputs } from "../deployments/runInputs";
import { promotionActions, promotionInput, promotionRun } from "./databasePromotion.fixture";
import { restoreADatabaseWriterV1 as incident } from "../challenges/definitions/restore-a-database-writer/v1";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";
import { captureRunInputs } from "../deployments/runInputs";
import { recordedScenario, verifiedScenario } from "../challenges/scenario";
import { challengeSeed } from "../challenges/registry";

const ha = (row: ReturnType<typeof promotionRun>["row"]) => buildRunReport(row).terminal!.resources.find(r => r.id === "db")!.databaseReplication!;
const raw = (row: ReturnType<typeof promotionRun>["row"]) => (row.terminalSnapshot as SimulationSnapshot).metrics.db!.databaseReplication!;

test("controlled real runs add a replacement replica without changing caller recovery or erasing promotion loss", () => {
  const legacy = promotionRun(2), recovered = promotionRun(2, 1, "primary", true), slow = promotionRun(2, 60000, "primary", true);
  const r = ha(recovered.row);
  expect(ha(legacy.row)).toMatchObject({primaryRole: "fenced", currentWriter: "replica"});
  expect(r).toMatchObject({primaryRole: "replica", primaryProcessState: "replica", primaryEpoch: 2, writerEpoch: 2,
    rejoin: {epoch: 2, state: "replica", snapshotApplied: true, eligible: true, committedOperations: 60, replayedOperations: 60, pendingOperations: 0}});
  expect(buildRunReport(recovered.row).terminal!.traffic).toEqual(buildRunReport(legacy.row).terminal!.traffic);
  expect(ha(slow.row)).toMatchObject({pendingReplication: 0, lostOperations: 10, primaryRole: "fenced",
    rejoin: {state: "catching-up", snapshotApplied: false, eligible: false, pendingBatches: 61, pendingOperations: 60, replayedOperations: 0}});
  expect(ha(slow.row).regressedKeyCount).toBeGreaterThan(0);
  const saved = {...slow.row, runInputs: JSON.parse(JSON.stringify(slow.row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(slow.row.terminalSnapshot)), actions: JSON.parse(JSON.stringify(slow.row.actions))};
  expect(ha(saved)).toEqual(ha(slow.row));
  const marked = structuredClone(REFERENCE[incident.id]!); marked.resources[1]!.databaseReplication!.rejoin = "snapshot-replay/1";
  const incidentReport = buildRunReport(attemptRow(incident, marked, answers(incident, {"overall-health": "healthy"})));
  const after = incidentReport.actions[0]!.outcome!.databaseIncident!.after!.replication!;
  expect(after.rejoin).toMatchObject({state: "replica", eligible: true});
  for (const a of incidentReport.actions) expect(Buffer.byteLength(JSON.stringify(a.outcome), "utf8")).toBeLessThan(32768);
  console.info(JSON.stringify({regression: "opt-in-rejoin", fast: r.rejoin, slow: ha(slow.row).rejoin, lost: ha(slow.row).lostOperations}));
});

test("saved rejoin evidence keeps missing counts/eligibility Unknown and refuses malformed populations", () => {
  const {row} = promotionRun(2, 60000, "primary", true);
  for (const value of [undefined, null]) {
    const missing = structuredClone(row);
    if (value === undefined) delete raw(missing).rejoin; else raw(missing).rejoin = null;
    expect(ha(missing).rejoin).toBe(value);
    expect(ha(missing)).toMatchObject({lostOperations: 10, pendingReplication: 0});
  }
  const partial = structuredClone(row), evidence = raw(partial).rejoin!;
  Reflect.deleteProperty(evidence, "pendingOperations"); Reflect.deleteProperty(evidence, "eligible");
  expect(ha(partial).rejoin).toMatchObject({pendingOperations: null, eligible: null});
  for (const field of ["pendingOperations", "replayedOperations", "epoch", "pendingBatches"] as const) for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const malformed = structuredClone(row); raw(malformed).rejoin![field] = value;
    expect(buildRunReport(malformed).terminal).toBeNull();
  }
  const malformed = structuredClone(row); Reflect.set(raw(malformed).rejoin!, "eligible", 1);
  expect(buildRunReport(malformed).terminal).toBeNull();
});

test("saved rejoin intent requires its exact captured profile, owned binding and bounded policy", () => {
  const input = promotionInput(1, true);
  expect(input.adapterProfiles).toContain("db-rejoin/1");
  expect(readRunInputs(JSON.parse(JSON.stringify(input)))).toEqual(input);
  const missing = structuredClone(input); missing.adapterProfiles = missing.adapterProfiles!.filter(p => p !== "db-rejoin/1");
  expect(buildContractFromRunInputs(missing, 8)).toHaveProperty("refused");
  const legacy = promotionInput(); legacy.adapterProfiles!.push("db-rejoin/1");
  expect(buildContractFromRunInputs(legacy, 8)).toHaveProperty("refused");
  for (const value of [null, false, "snapshot-replay/2", {}]) {
    const bad = {...input.resources.find(r => r.id === "db")!.databaseReplication!, rejoin: value};
    expect(databaseReplicationError("Database", bad)).toContain("snapshot-replay/1");
    const altered = JSON.parse(JSON.stringify(input)); altered.resources[1].databaseReplication = bad;
    expect(() => readRunInputs(altered)).toThrow();
  }
  const built = buildContractFromRunInputs(input, 8); if ("refused" in built) throw Error(JSON.stringify(built));
  expect(built.contract.version).toContain("/db-rejoin/1");
  expect(built.contract.ledger.some(e => e.assumptions.some(a => a.includes("No physical timing")))).toBe(true);
  const design = {schema: "infraforge-saved-design/1" as const, resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile};
  const compiled = compileProduct(design, built.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const altered = structuredClone(built.contract);
  const db = altered.nodes.db!.resources.find(r => r.config.kind === "relational")!.config;
  if (db.kind !== "relational") throw Error("Missing relational engine");
  delete db.replication!.rejoin;
  expect(compileProduct(design, altered).ok).toBe(false);
  const noProfile = structuredClone(built.contract); noProfile.version = noProfile.version.replace("/db-rejoin/1", "");
  expect(compileProduct(design, noProfile).ok).toBe(false);
});

test("opt-in catch-up replays identically in browser target and independently reconstructed server every tick", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/database-rejoin-browser-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserFactory: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const [promoteAt, delay, outage] of [[null, 1, "primary"], [2, 1, "primary"], [5, 50, "primary"], [2, 60000, "primary"], [null, 2000, "replica"]] as const) {
      const input = readRunInputs(JSON.parse(JSON.stringify(promotionInput(delay, true))));
      const browser = browserFactory(input, 8), replay = promotionRun(promoteAt, delay, outage, true);
      for (let second = 1; second <= 8; second++) {
        browser.advance();
        expect(browser.view()).toEqual(replay.samples[second - 1]!.view);
        expect(browser.evidence()).toEqual(replay.samples[second - 1]!.evidence);
        const e = browser.evidence().data.databases[0]!.databaseReplication!;
        const writers = Number(e.primaryRole === "writer" && e.primaryProcessState === "available") + Number(e.replicaRole === "writer" && e.replicaProcessState === "writer");
        expect(writers).toBe(e.currentWriter === "none" ? 0 : 1);
        if (e.rejoin) expect(e.rejoin.committedOperations).toBe(e.rejoin.replayedOperations + e.rejoin.pendingOperations);
        for (const action of promotionActions(promoteAt, outage).filter(a => a.atSecond === second)) browser.apply(action.request);
      }
      expect(ha(replay.row)).toEqual(browser.view().metrics.db!.databaseReplication!);
    }
    // Existing published incident, new opt-in design only: retained/reconstructed scenario uses the same path.
    const design = structuredClone(REFERENCE[incident.id]!); design.resources[1]!.databaseReplication!.rejoin = "snapshot-replay/1";
    const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design, incident.workload, challengeSeed(incident)))));
    const plan = recordedScenario(incident, input)!, serverPlan = verifiedScenario(JSON.parse(JSON.stringify(plan)), incident, input);
    const browser = browserFactory(input, 14), server = createModel2Run(input, 14);
    for (let second = 1; second <= 14; second++) {
      browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
      for (const step of plan.steps.filter(s => s.atSecond === second)) browser.apply({kind: "intervention", parameters: step.request});
      for (const step of serverPlan.steps.filter(s => s.atSecond === second)) server.apply({kind: "intervention", parameters: step.request});
    }
    const report = buildRunReport(attemptRow(incident, design, answers(incident, {"overall-health": "healthy"})));
    expect(report.terminal!.resources.find(r => r.id === "db")!.databaseReplication).toEqual(browser.view().metrics.db!.databaseReplication);
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
});
