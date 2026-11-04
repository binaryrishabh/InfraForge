import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import type { ActionRequest } from "@infraforge/contracts/actions";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { databaseLayout, databaseWorkload, promoteRequest } from "./databaseReplication.fixture";

test("browser bundle and official replay agree on routing, member outages, promotion and delayed crash recovery", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/database-read-routing-browser-${process.pid}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const module = await import(pathToFileURL(path).href), browserRun: typeof createModel2Run = module.createModel2Run;
    const proof = [];
    for (const policy of ["primary-only", "replica-preferred"] as const) for (const mode of ["steady", "primary-outage", "replica-outage", "promotion-return", "crash"] as const) {
      const layout = databaseLayout(2000, "primary"); layout.resources.at(-1)!.databaseReadRouting = { version: 1, policy };
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, databaseWorkload, "dbroute-parity"))));
      const horizon = mode === "crash" ? 38 : 8, browser = browserRun(input, horizon), actions: Array<{ second: number; request: ActionRequest }> = [];
      const views = [], evidence = [];
      for (let second = 0; second < horizon; second++) {
        let request: ActionRequest | undefined;
        if (second === 1 && mode !== "steady") request = mode === "crash"
          ? { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "db" } }
          : { kind: "intervention", parameters: { interventionId: mode === "replica-outage" ? "db-fail-replica" : "db-fail-primary", revision: 1, target: { resourceId: "db" }, parameters: { duration: 3 } } };
        if (second === 2 && mode === "promotion-return") request = promoteRequest;
        if (request) { browser.apply(request); actions.push({ second, request }); }
        browser.advance(); views.push(browser.view()); evidence.push(browser.evidence());
      }
      const server = createModel2Engine(input, horizon), wire = JSON.parse(JSON.stringify(actions)) as typeof actions;
      for (let second = 0; second < horizon; second++) {
        for (const action of wire.filter(a => a.second === second)) server.apply(action.request);
        server.advance(); expect(server.view()).toEqual(views[second]!); expect(server.evidence()).toEqual(evidence[second]!);
        expect(server.view().metrics.db!.database!.readRouting).toEqual(server.evidence().data.databases[0]!.databaseReadRouting!);
      }
      const db = server.evidence().data.databases[0]!, ha = db.databaseReplication!, routing = db.databaseReadRouting!;
      expect(db.transactions.live).toBe(0);
      for (const member of Object.values(routing.members)) {
        expect(member.admitted).toBe(member.committed + member.aborted + member.cancelled + member.active + member.queued);
        expect(member.peakActive).toBeLessThanOrEqual(member.activeLimit); expect(member.peakQueued).toBeLessThanOrEqual(member.queueLimit);
      }
      if (mode === "steady") { expect(routing.members.replica.admitted > 0).toBe(policy === "replica-preferred"); expect(routing.staleReads > 0).toBe(policy === "replica-preferred"); }
      if (mode === "primary-outage") {
        const down = evidence[2]!.data.databases[0]!;
        expect(down.databaseReplication!.currentWriter).toBe("none"); expect(down.databaseReplication!.failedWritesWithoutWriter).toBeGreaterThan(0);
        expect(down.databaseReplication!.replicaReads > 0).toBe(policy === "replica-preferred");
        expect(ha.currentWriter).toBe("primary");
      }
      if (mode === "replica-outage") {
        expect(evidence[2]!.data.databases[0]!.databaseReplication!.replicaProcessState).toBe("unavailable");
        expect(ha.replicaAppliedWrites).toBeGreaterThan(evidence[2]!.data.databases[0]!.databaseReplication!.replicaAppliedWrites);
      }
      if (mode === "promotion-return") { expect(ha).toMatchObject({ currentWriter: "replica", primaryProcessState: "fenced", writerEpoch: 2 }); expect(ha.replicaCommittedWrites).toBeGreaterThan(0); expect(ha.fencedReplicationRejections).toBe(ha.lostOperations); }
      if (mode === "crash") {
        // Crash ends at 31 s; readiness takes one more second. No new work runs before readiness.
        expect(evidence[30]!.data.databases[0]!.transactions.admitted).toBe(evidence[29]!.data.databases[0]!.transactions.admitted);
        expect(db.transactions.admitted).toBeGreaterThan(evidence[30]!.data.databases[0]!.transactions.admitted);
        expect(ha).toMatchObject({ primaryProcessState: "available", replicaProcessState: "available" });
      }
      proof.push({ policy, mode, primaryCpuUs: routing.members.primary.consumedCoreUs, replicaCpuUs: routing.members.replica.consumedCoreUs, staleReads: routing.staleReads, failed: db.transactions.aborted, invalidations: ha.sessionInvalidations });
    }
    console.info("dbroute-browser-server", JSON.stringify(proof));
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
});
