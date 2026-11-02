import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { monitoringLayout, monitoringWorkload } from "./monitoringCadence.fixture";
import { objectLayout, objectWorkload } from "./objectCapacity.fixture";
import { firewallLayout, firewallWorkload } from "./firewallCapacity.fixture";

test("captured monitoring, object and firewall readouts agree with official server replay in a browser-target bundle", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/observability-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const module = await import(pathToFileURL(browserPath).href), browserRun: typeof createModel2Run = module.createModel2Run;
    let cases = 0, capacityRefusals = 0;
    for (const type of ["monitoring", "object", "firewall"] as const) for (const explicit of [false, true]) for (const replay of [false, true]) {
      const layout = type === "monitoring" ? monitoringLayout(explicit ? { version: 2, bufferSamples: 2, batchSamples: 1, exportAttempts: 1, collectionIntervalSeconds: 1, exportIntervalSeconds: 3 } : undefined, true)
        : type === "object" ? objectLayout("upload", explicit ? 1 : undefined) : firewallLayout(explicit ? 1 : undefined, true);
      const workload = type === "monitoring" ? monitoringWorkload : type === "object" ? objectWorkload("upload") : firewallWorkload;
      const captured = captureRunInputs(layout, workload, "observability-live-parity");
      if (!explicit) delete captured.adapterProfiles;
      const seconds = type === "object" ? 30 : 8;
      const input = readRunInputs(JSON.parse(JSON.stringify(captured))), browser = browserRun(input, seconds), server = createModel2Engine(input, seconds, buildModel2Contract);
      for (let second = 1; second <= seconds; second++) {
        browser.advance(); server.advance();
        const view = browser.view(), evidence = server.evidence();
        expect(view).toEqual(server.view()); expect(browser.evidence()).toEqual(evidence);
        if (type === "monitoring") for (const row of evidence.systems.monitors) {
          expect(view.metrics[row.id]!.monitoring).toEqual({ version: 1, generated: row.generated, collections: row.collections, collectionFailures: row.collectionFailures,
            exported: row.exported, dropped: row.dropped, droppedBeforeExport: row.droppedBeforeExport, discardedUnconfirmed: row.discardedUnconfirmed,
            batches: row.batches, failedBatches: row.failedBatches, bufferedSamples: row.buffered.length, bufferedBytes: row.bufferedBytes,
            inFlightSamples: row.inFlight.reduce((n, b) => n + b.rows.length, 0), inFlightBytes: row.inFlightBytes, freshness: row.freshness });
        }
        if (type === "object") for (const row of evidence.asynchronous.objects) {
          expect(view.metrics[row.id]!.objectStorage).toEqual({ version: 1, storedBytes: row.storedBytes, capacityBytes: row.capacityBytes,
            committedPuts: row.committedPuts, replacedObjects: row.replacedObjects, removedObjects: row.removedObjects, deletes: row.deletes, "object-capacity": row.service.reasons["object-capacity"] ?? null });
          capacityRefusals += row.service.reasons["object-capacity"] ?? 0;
        }
        if (type === "firewall") for (const row of evidence.systems.security.policies) {
          const config = evidence.systemConfiguration.firewalls.find(p => p.id === row.id)!;
          expect(config.maxFlows.kind).toBe("known");
          expect(view.metrics[row.id]!.security!.firewall).toMatchObject({ occupancy: row.flows.length, limit: config.maxFlows.kind === "known" ? config.maxFlows.value : null,
            admissions: row.opened, policyDenied: row.denied, "flow-capacity": null });
        }
        if (second === 2 && replay) {
          const request = JSON.parse(JSON.stringify({ kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: type === "monitoring" ? "vm" : type === "object" ? "store" : "app" } }));
          expect(browser.apply(request)).toEqual(server.apply(request));
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
      }
      cases++;
    }
    expect(capacityRefusals).toBeGreaterThan(0);
    console.info("observability-browser-server-parity", JSON.stringify({ cases, simulatedSecondsPerCase: { monitoring: 8, object: 30, firewall: 8 }, capacityRefusals }));
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
}, 180000);
