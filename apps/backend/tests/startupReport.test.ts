import { expect, test } from "bun:test";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { readRecords } from "../reports/records";
import { buildRunReport } from "../reports/report";
import { StartupSchema } from "../reports/startupSchema";
import { checkLessonClaims } from "../learning/claims";
import { findLearningLesson } from "../learning/registry";
import { definition } from "./challengeHarness";
import { startupReportCases } from "./startupReport.fixture";

const cases = startupReportCases();
const base = cases[0]!;
const snapshot = (row: typeof base.row) => row.terminalSnapshot as SimulationSnapshot;

test("real owned registry, image, layer and replica observations survive production capture and report parsing", () => {
  for (const fixture of cases) {
    const last = fixture.samples.at(-1)!, limits: string[] = [];
    const records = readRecords(JSON.parse(JSON.stringify(fixture.row)), limits);
    expect(limits).toEqual([]);
    for (const checkpoint of [records.checkpoint!, records.terminal!, fixture.report.terminal!]) {
      for (const r of checkpoint.resources.filter(r => r.startup)) expect(r.startup).toEqual(last.metrics[r.id]!.startup);
    }
    for (const {raw, metrics, second} of fixture.samples) {
      for (const node of Object.values(metrics).filter(m => m.startup)) {
        const m = node.startup!;
        expect(m.sampledAtUs).toBe(second * 1000000);
        expect(StartupSchema.parse(m)).toEqual(m);
        for (const r of m.registries!) {
          const owned = raw.systems.registries.find(s => s.id === r.id)!;
          const {manifests, tags, omittedBlobs, omittedManifests, omittedTags, ...retained} = r;
          for (const [k, v] of Object.entries(retained)) expect(owned).toHaveProperty(k, v);
          expect(manifests).toEqual(owned.manifests.map(x => ({...x, omittedLayers: 0})));
          expect(tags).toEqual(Object.entries(owned.tags).map(([tag, digest]) => ({tag, digest})));
          expect([omittedBlobs, omittedManifests, omittedTags]).toEqual([0, 0, 0]);
        }
        for (const c of m.clients!) {
          const owned = raw.systems.clients.find(s => s.id === c.id)!;
          for (const key of ["cachedBytes", "pulledBytes", "reusedLayers", "failures", "cache"] as const) expect(c[key]).toEqual(owned[key]);
          expect(c.events).toEqual(owned.events.rows); expect(c.omittedEvents).toBe(owned.events.omitted);
          expect(c.replicas).toEqual(owned.replicas.map(r => ({id: r.id, target: r.target, reference: r.reference, state: r.state, attempts: r.attempts,
            artifactReadyAtUs: r.readyAt, resolvedDigest: r.resolvedDigest, requiredLayers: r.requiredLayers, omittedLayers: 0})));
          expect("generation" in owned.replicas[0]!).toBe(false);
        }
        for (const c of m.controllers!) {
          const owned = raw.product.controllers.find(s => s.id === c.id)!;
          expect(c.inService).toBe(owned.inService); expect(c.desired).toBe(owned.desired);
          expect(c.events).toEqual(owned.events);
          expect(c.replicas).toEqual(owned.replicas.map(r => ({id: r.id, ordinal: r.ordinal, state: r.state, createdAtUs: r.createdAt, listenerReadyAtUs: r.readyAt,
            attempts: r.attempts, endpointAlive: r.endpoint.alive, endpointReady: r.endpoint.ready, lbHealthy: r.lb.health, lbDraining: r.lb.draining})));
        }
      }
    }
  }
});

test("one saved ceiling changes real growth; artifact-ready, listener-ready and current LB eligibility are distinct", () => {
  const ceiling = structuredClone(base.input); ceiling.resources.find(r => r.id === "app")!.autoscaling!.maxReplicas = 1;
  expect(ceiling).toEqual(cases[1]!.input);
  const metrics = (i: number, second = 16) => cases[i]!.samples[second - 1]!.metrics.app!.startup!;
  const before = metrics(0, 10).controllers![0]!;
  expect(before.desired).toBe(3); expect(before.inService).toBe(1);
  expect(before.replicas!.find(r => r.id === "app#1")).toMatchObject({createdAtUs: 10000000, listenerReadyAtUs: null, endpointReady: false});
  const acquiring = metrics(0, 12), a = acquiring.clients!.find(c => c.id === "app#1/image")!;
  expect(a.replicas![0]!.artifactReadyAtUs).toBe(11001071);
  expect(acquiring.controllers![0]!.replicas!.find(r => r.id === "app#1")!.listenerReadyAtUs).toBeNull();
  const end = metrics(0), r = end.controllers![0]!.replicas!.find(r => r.id === "app#1")!;
  expect(r.listenerReadyAtUs).toBe(a.replicas![0]!.artifactReadyAtUs! + 1000000);
  expect(end.controllers![0]!.inService).toBe(3); expect(metrics(1).controllers![0]!.inService).toBe(1);
  const failed = metrics(2).clients!.find(c => c.id === "app#1/image")!;
  expect(failed).toMatchObject({failures: 3, pulledBytes: 0});
  expect(failed.replicas![0]).toMatchObject({reference: "missing-release", resolvedDigest: null, artifactReadyAtUs: null, attempts: 3, state: "failed"});
  expect(failed.events!.every(e => e.detail === "manifest-unavailable")).toBe(true);
  expect(metrics(2).controllers![0]!.inService).toBe(1);
  const warm = metrics(3).clients!.find(c => c.id === "app#1/image")!;
  expect(warm).toMatchObject({pulledBytes: 0, reusedLayers: 1, cachedBytes: 1024});
  expect(warm.replicas![0]!.artifactReadyAtUs).toBeLessThan(a.replicas![0]!.artifactReadyAtUs!);
  console.info("startup-evidence", JSON.stringify(cases.map(c => {const m = c.samples.at(-1)!.metrics.app!.startup!; return {clients: m.clients!.map(a => ({id: a.id, pulledBytes: a.pulledBytes, reusedLayers: a.reusedLayers, failures: a.failures, artifactReadyAtUs: a.replicas![0]!.artifactReadyAtUs})), controller: m.controllers![0]};})));
});

test("older and incomplete observations remain Unknown; malformed counters, bounds, digests and time windows refuse evidence", () => {
  const old = structuredClone(base.row); delete snapshot(old).metrics.app!.startup;
  expect(buildRunReport(old).terminal!.resources.find(r => r.id === "app")!.startup).toBeUndefined();
  const partial = {version: 1 as const, clients: [{id: "app#1/image", pulledBytes: 1024}]};
  expect(StartupSchema.parse(partial)).toEqual(partial);
  expect(StartupSchema.parse({version: 1, registries: null, clients: null, controllers: null})).toEqual({version: 1, registries: null, clients: null, controllers: null});
  const mutations = [
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.sampledAtUs = 1;},
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.clients![1]!.pulledBytes = -1;},
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.clients![1]!.failures = Number.MAX_SAFE_INTEGER + 1;},
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.clients![1]!.replicas![0]!.artifactReadyAtUs = 17000000;},
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.clients![1]!.replicas![0]!.resolvedDigest = "unverified";},
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.clients!.push(m.clients![0]!);},
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.controllers![0]!.replicas![1]!.listenerReadyAtUs = 1;},
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.clients![1]!.cache![0]!.bytes = 1;},
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.registries![0]!.blobBytes = Infinity;},
    (m: NonNullable<SimulationSnapshot["metrics"][string]["startup"]>) => {m.clients![1]!.replicas![0]!.requiredLayers = Array.from({length: 101}, () => m.clients![1]!.cache![0]!);},
  ];
  for (const mutate of mutations) {
    const row = structuredClone(base.row); mutate(snapshot(row).metrics.app!.startup!);
    const report = buildRunReport(row); expect(report.terminal).toBeNull();
    expect(report.unknown.join(" ")).toContain("terminal record is malformed");
    const limits: string[] = []; row.simulationState = row.terminalSnapshot;
    expect(readRecords(row, limits).checkpoint!.resources.find(r => r.id === "app")).toBeUndefined();
    expect(limits.join(" ")).toContain("Checkpoint measurements for resource app are malformed");
  }
});

test("claim gate accepts only audited startup labels and refuses unowned generation, delivery and availability measurements", () => {
  const d = definition("budget-app-database-sessions"), source = findLearningLesson(d.id)!;
  if (source.kind !== "executable-lab") throw Error("Expected existing lab");
  const labels = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([,m]) => m.path.startsWith("startup.")).map(([label]) => label);
  expect(labels).toHaveLength(50);
  for (const label of labels) expect(checkLessonClaims({...source, experiment: {...source.experiment, evidenceToInspect: [label]}}, d)).toEqual([]);
  for (const label of ["Replica generation", "First LB-eligible time", "Registry delivered bytes", "Startup availability percentage"]) {
    expect(checkLessonClaims({...source, experiment: {...source.experiment, evidenceToInspect: [label]}}, d).join(" ")).toContain("report does not render measurement");
  }
});
