import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DeploymentChaosNames, type Resource } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { cdnLayout, cdnWorkload } from "./cdnTtl.fixture";

function dataLayout(explicit: boolean) {
  const resources: Resource[] = [
    { id: "app", type: "Virtual Machine", x: 0, y: 0 },
    { id: "cache", type: "Cache", x: 1, y: 0, ...(explicit ? { cachePolicy: { version: 2 as const, capacityEntries: 2, ttlSeconds: 1, singleFlight: true } } : {}) },
    { id: "db", type: "Database", x: 2, y: 0, ...(explicit ? { dataKeyspace: { version: 1 as const, count: 10 }, dbConcurrency: { version: 1 as const, activeQueries: 1, queuedQueries: 0 } } : {}) },
  ];
  return { resources, connectionLines: [
    { id: "app-cache", sourceId: "app", targetId: "cache", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 },
    { id: "cache-db", sourceId: "cache", targetId: "db", sourceType: "Cache", targetType: "Database", port: 5432 },
  ] };
}

test("captured DB/cache/CDN readings, official evidence and recorded actions agree in a browser-target bundle", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/data-delivery-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const module = await import(pathToFileURL(browserPath).href), browserRun: typeof createModel2Run = module.createModel2Run;
    let cases = 0;
    for (const type of ["data", "cdn"] as const) for (const explicit of [false, true]) for (const replay of [false, true]) {
      const layout = type === "data" ? dataLayout(explicit) : cdnLayout();
      if (type === "cdn" && explicit) layout.resources[0]!.cdnCachePolicy = { version: 2, coalesce: true, maxWaiters: 1, ttlSeconds: 1 };
      const captured = captureRunInputs(layout, { ...cdnWorkload, targetThroughput: type === "data" ? 7200 : 120 }, "data-delivery-parity");
      // Historical captured designs have no optional adapter selection or new metric blocks.
      if (!explicit) delete captured.adapterProfiles;
      const input = readRunInputs(JSON.parse(JSON.stringify(captured)));
      const browser = browserRun(input, 4), server = createModel2Engine(input, 4, buildModel2Contract);
      for (let second = 1; second <= 4; second++) {
        browser.advance(); server.advance();
        const view = browser.view(), e = server.evidence();
        expect(view).toEqual(server.view()); expect(browser.evidence()).toEqual(e);
        if (type === "data") {
          expect(view.metrics.cache!.cache).toMatchObject({ hits: e.data.caches[0]!.hits, misses: e.data.caches[0]!.misses, evictions: e.data.caches[0]!.evictions, expirations: e.data.caches[0]!.expirations, coalescedWaiters: e.data.applications[0]!.coalescedWaiters });
          expect(view.metrics.db!.database).toMatchObject({ queued: e.data.databases[0]!.queued, "query-queue-full": e.data.databases[0]!.reasons["query-queue-full"] ?? null });
          expect(view.metrics.db!.cache).toBeUndefined(); expect(view.metrics.cache!.database).toBeUndefined();
        } else {
          const cdn = e.systems.cdns[0]!;
          expect(view.metrics.cdn!.cdn).toMatchObject({ hits: cdn.hits, misses: cdn.misses, originRequests: cdn.originRequests, fills: cdn.fills, expirations: cdn.expirations, coalesced: cdn.coalesced, purged: cdn.purged, staleFills: cdn.staleFills, "cdn-waiter-capacity": null });
        }
        if (second === 1 && replay) {
          const action = JSON.parse(JSON.stringify(type === "data" ? { kind: "load", parameters: { targetLoadFraction: 0.5 } } : { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "cdn" } }));
          expect(browser.apply(action)).toEqual(server.apply(action));
          while (browser.catchingUp) browser.catchUp(10);
          while (server.catchingUp) server.catchUp(10);
        }
      }
      cases++;
    }
    console.info("data-delivery-browser-server-parity", JSON.stringify({ cases, simulatedSecondsPerCase: 4 }));
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
}, 180000);
