import { expect, test } from "bun:test";
import { buildRunReport } from "../reports/report";
import { evaluateStartupCapacity } from "../challenges/startupCapacityCriterion";
import { validateChallengeVersions } from "../challenges/validate";
import { specHash } from "../challenges/registry";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { artifactAdmissionLabFixture } from "./artifactAdmissionLab.fixture";

test("startup criterion refuses absent, omitted, stale, malformed and contradictory readiness evidence", () => {
  const {d, rows} = artifactAdmissionLabFixture(), good = rows[1]!, raw = (r: typeof good) => r.terminalSnapshot as SimulationSnapshot;
  const startup = (r: typeof good) => raw(r).metrics.app!.startup!, controller = (r: typeof good) => startup(r).controllers![0]!, cold = (r: typeof good) => controller(r).replicas![1]!;
  const changes: Array<(r: typeof good) => void> = [
    r => {r.runInputs = null;}, r => {r.terminalSnapshot = null;}, r => {r.runtimeActive = true;}, r => {r.topologyRevision++;},
    r => {raw(r).simulatedSeconds--;}, r => {(raw(r) as {metricsTopologyRevision?: number}).metricsTopologyRevision = -1;},
    r => {delete raw(r).metrics.app!.startup;}, r => {startup(r).sampledAtUs = null;}, r => {startup(r).sampledAtUs!--;},
    r => {startup(r).controllers = null;}, r => {startup(r).omittedControllers = 1;}, r => {startup(r).omittedControllers = null;},
    r => {controller(r).id = "other";}, r => {controller(r).replicas!.pop();}, r => {controller(r).omittedReplicas = 1;},
    r => {controller(r).events = null;}, r => {controller(r).omittedEvents = 1;}, r => {controller(r).omittedEvents = null;},
    r => {controller(r).events = controller(r).events!.filter(e => e.kind !== "initial-ready");},
    r => {controller(r).events = controller(r).events!.filter(e => e.kind !== "readiness");},
    r => {controller(r).events = controller(r).events!.filter(e => e.kind !== "replica-created");},
    r => {cold(r).id = "foreign#1";}, r => {cold(r).ordinal = 0;}, r => {cold(r).ordinal = 1.5;},
    r => {cold(r).createdAtUs = null;}, r => {cold(r).createdAtUs = 0;}, r => {cold(r).listenerReadyAtUs = null;},
    r => {delete cold(r).listenerReadyAtUs;}, r => {cold(r).listenerReadyAtUs = 21_000_000;},
    r => {cold(r).listenerReadyAtUs = 9_000_000;}, r => {cold(r).listenerReadyAtUs = -1;}, r => {cold(r).listenerReadyAtUs = 12.5;},
    r => {cold(r).endpointAlive = null;}, r => {cold(r).endpointReady = null;}, r => {cold(r).lbHealthy = null;}, r => {cold(r).lbDraining = null;},
    r => {controller(r).inService = 1;}, r => {controller(r).desired = 3;},
  ];
  for (const [i, change] of changes.entries()) {
    const bad = structuredClone(good); change(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "ready")!.status, `mutation ${i}`).toBe("not-evaluated");
  }
  const report = buildRunReport(good), c = d.criteria.find(c => c.kind === "startup-capacity")!;
  if (c.kind !== "startup-capacity") throw Error("Expected criterion");
  expect(evaluateStartupCapacity(c, null, report.terminal, 20).met).toBeUndefined();
  expect(evaluateStartupCapacity(c, d.starter, {...report.terminal!, measurementFreshness: "previous-revision"}, 20).met).toBeUndefined();
  // Recorded false flags are known non-eligibility; Unknown flags never become false/zero.
  const unhealthy = structuredClone(good); cold(unhealthy).lbHealthy = false; controller(unhealthy).inService = 1;
  expect(buildRunReport(unhealthy).challenge!.criteria.find(c => c.id === "ready")!.status).toBe("not-met");
  const historical = structuredClone(good); for (const client of startup(historical).clients!) delete client.capacityBytes;
  expect(buildRunReport(historical).challenge!.criteria.find(c => c.id === "ready")!.status).toBe("met"); // Generic readiness uses measured lifecycle, never invents cache bytes.
});
test("authoring requires a named enabled VM and a bounded achievable later-ready count", () => {
  const {d} = artifactAdmissionLabFixture();
  expect(validateChallengeVersions([d], {[`${d.id}@1`]: specHash(d)})).toEqual([]);
  for (const patch of [{resourceId: "lb"}, {resourceId: "missing"}, {minNewReady: 0}, {minNewReady: 1.5}, {minNewReady: 101}, {minNewReady: 2}]) {
    const bad = structuredClone(d); Object.assign(bad.criteria[1]!, patch);
    expect(validateChallengeVersions([bad], {[`${d.id}@1`]: specHash(bad)}).join(" ")).toContain("startup-capacity");
  }
  const bad = structuredClone(d); bad.starter!.resources[1]!.autoscaling!.enabled = false;
  expect(validateChallengeVersions([bad], {[`${d.id}@1`]: specHash(bad)}).join(" ")).toContain("startup-capacity");
});
