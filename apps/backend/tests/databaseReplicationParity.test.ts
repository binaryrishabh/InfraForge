import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import type { ActionRequest } from "@infraforge/contracts/actions";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { databaseLayout, databaseWorkload, promoteRequest } from "./databaseReplication.fixture";

test("captured replication, stale reads and promotion match browser-target bundle and server replay", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/database-replication-browser-${process.pid}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const module = await import(pathToFileURL(path).href), browserRun: typeof createModel2Run = module.createModel2Run;
    const proof = [];
    for (const mode of ["primary", "stale", "promotion", "fenced-restart", "primary-outage", "primary-preferred-outage", "primary-promotion-return", "replica-outage"] as const) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(databaseLayout(2000, (mode === "primary" || mode === "primary-outage") ? "primary" : "replica-preferred"), databaseWorkload, "ha-parity"))));
      const horizon = mode === "fenced-restart" ? 38 : 8;
      const browser = browserRun(input, horizon), views = [], evidence = [], actions: Array<{ atSecond: number; request: ActionRequest }> = [];
      for (let second = 0; second < horizon; second++) {
        if (["primary-outage", "primary-preferred-outage", "primary-promotion-return", "replica-outage"].includes(mode) && second === 1) {
          const request: ActionRequest = { kind: "intervention", parameters: { interventionId: mode === "replica-outage" ? "db-fail-replica" : "db-fail-primary", revision: 1, target: { resourceId: "db" }, parameters: { duration: 3 } } };
          browser.apply(request); actions.push({ atSecond: second, request });
        }
        if (mode === "primary-promotion-return" && second === 2) {
          expect(browser.interventionOptions().some(o => o.interventionId === "db-promote-replica")).toBe(true);
          browser.apply(promoteRequest); actions.push({ atSecond: second, request: promoteRequest });
        }
        if ((mode === "promotion" || mode === "fenced-restart") && second === 1) {
          const outcome = browser.apply(promoteRequest); expect(outcome.outcome.intervention).toMatchObject({ atUs: 1_000_001, endUs: null });
          actions.push({ atSecond: second, request: promoteRequest });
        }
        if (mode === "fenced-restart" && second === 2) {
          const request: ActionRequest = { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "db" } };
          browser.apply(request); actions.push({ atSecond: second, request });
        }
        browser.advance(); views.push(browser.view()); evidence.push(browser.evidence());
      }
      const server = createModel2Engine(input, horizon);
      const wire = JSON.parse(JSON.stringify(actions)) as typeof actions;
      for (let second = 0; second < horizon; second++) {
        for (const action of wire.filter(a => a.atSecond === second)) server.apply(action.request);
        server.advance(); expect(server.view()).toEqual(views[second]!); expect(server.evidence()).toEqual(evidence[second]!);
        const measured = server.evidence().data.databases[0]!.databaseReplication!;
        expect(server.view().metrics.db!.databaseReplication).toMatchObject({ currentWriter: measured.currentWriter, writerEpoch: measured.writerEpoch, pendingReplication: measured.pendingReplication, lagMs: measured.lagMs, replicaReads: measured.replicaReads, staleReplicaReads: measured.staleReplicaReads, lostOperations: measured.lostOperations, fencedWriteRejections: measured.fencedWriteRejections });
      }
      const ha = server.evidence().data.databases[0]!.databaseReplication!;
      if (mode === "primary-outage" || mode === "primary-preferred-outage") {
        expect(ha).toMatchObject({ currentWriter: "primary", primaryProcessState: "available", writerEpoch: 1 });
        expect(ha.failedWritesWithoutWriter).toBeGreaterThan(0);
        expect(ha.connectionInvalidations).toBeGreaterThan(0);
        expect(ha.primaryCommittedWrites).toBeGreaterThan(evidence[3]!.data.databases[0]!.databaseReplication!.primaryCommittedWrites);
      }
      if (mode === "primary-promotion-return") {
        expect(ha).toMatchObject({ currentWriter: "replica", primaryProcessState: "fenced", replicaRole: "writer", writerEpoch: 2 });
        expect(ha.replicaCommittedWrites).toBeGreaterThan(0);
        expect(ha.failedWritesWithoutWriter).toBeGreaterThan(0);
        expect(ha.fencedReplicationRejections).toBe(ha.lostOperations);
      }
      if (mode === "replica-outage") {
        expect(evidence[2]!.data.databases[0]!.databaseReplication).toMatchObject({ currentWriter: "primary", replicaProcessState: "unavailable", failedWritesWithoutWriter: 0 });
        expect(ha).toMatchObject({ replicaProcessState: "available", currentWriter: "primary", writerEpoch: 1 });
        expect(ha.replicaAppliedWrites).toBeGreaterThan(0);
      }
      if (mode === "primary") expect(ha.replicaReads).toBe(0);
      if (mode === "stale") expect(ha.staleReplicaReads).toBeGreaterThan(0);
      if (mode === "promotion") { expect(ha.lostOperations).toBeGreaterThan(0); expect(ha.replicaCommittedWrites).toBeGreaterThan(0); }
      if (mode === "fenced-restart") {
        expect(ha).toMatchObject({ currentWriter: "replica", writerEpoch: 2, primaryEpoch: 1, primaryRole: "fenced", replicaRole: "writer" });
        expect(server.view().metrics.db!.health).not.toBe("failed"); expect(ha.replicaCommittedWrites).toBeGreaterThan(0);
        expect(ha.fencedReplicationRejections).toBe(ha.lostOperations);
      }
      proof.push({ mode, writer: ha.currentWriter, epoch: ha.writerEpoch, writes: ha.primaryCommittedWrites, replicaWrites: ha.replicaCommittedWrites, staleReads: ha.staleReplicaReads, lost: ha.lostOperations, fencedReplication: ha.fencedReplicationRejections });
    }
    console.info("database-replication-parity", JSON.stringify(proof));
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
});
