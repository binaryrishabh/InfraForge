import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import type { ActionRequest } from "@infraforge/contracts/actions";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import type { ContractBuilder, Quantity } from "@infraforge/simulation/internal-product";
import { cdnLayout, cdnWorkload } from "./cdnTtl.fixture";

test("captured CDN live purge browser bundle equals serialized server replay for warm, down and in-flight origins", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/cdn-purge-parity-${process.pid}.ts`), bundle = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), {recursive: true});
  try {
    await writeFile(entry, 'export {createModel2Run} from "../packages/simulation/src/model2Run";\nexport {buildModel2Contract} from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", bundle], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const module = await import(pathToFileURL(bundle).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserBuild: ContractBuilder = module.buildModel2Contract;
    const proof = [];
    for (const mode of ["baseline", "warm", "origin-down", "shared-fill", "independent-fills"] as const) {
      const layout = cdnLayout(), inFlight = mode === "shared-fill" || mode === "independent-fills";
      if (inFlight) layout.resources[0]!.cdnCachePolicy = {version: 2, coalesce: mode === "shared-fill"};
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, {...cdnWorkload, targetThroughput: inFlight ? 240 : 120}, "cdn-purge-parity"))));
      // Explicit synthetic origin timings let successful fills cross the live action boundary.
      const adjust = (builder: ContractBuilder): ContractBuilder => (...args) => {
        const result = builder(...args); if ("refused" in result || !inFlight) return result;
        const set = (quantity: Quantity<"us">, value: number) => {
          if (quantity.kind !== "known") throw Error("Expected authored timing");
          quantity.value = value;
          const entry = result.contract.ledger.find(e => e.id === quantity.provenance[0])!;
          entry.quantity = {...quantity}; entry.formula = String(value);
        };
        for (const node of Object.values(result.contract.nodes)) for (const role of node.resources) {
          if (role.config.kind === "cdn" || role.config.kind === "object-store") set(role.config.timeout, 4_000_000);
          if (role.config.kind === "object-store") set(role.config.demands.get!.wait, 2_000_000);
        }
        return result;
      };
      const browser = browserRun(input, 10, adjust(browserBuild));
      const submitted: Array<{atSecond: number; request: ActionRequest}> = [];
      const snapshots = [];
      for (let second = 0; second < 10; second++) {
        const requests: ActionRequest[] = [];
        if (mode === "origin-down" && second === 1) requests.push({kind: "chaos", parameters: {type: DeploymentChaosNames.Crash, resourceId: "store"}});
        if (mode !== "baseline" && second === (mode === "origin-down" ? 2 : 1)) requests.push({kind: "intervention", parameters: {interventionId: "cdn-purge", revision: 1, target: {resourceId: "cdn"}, parameters: {}}});
        for (const request of requests) {
          const applied = browser.apply(request);
          if (request.kind === "intervention") expect(applied.outcome.intervention).toMatchObject({atUs: second * 1_000_000 + 1, endUs: null});
          submitted.push({atSecond: second, request});
        }
        browser.advance(); snapshots.push({evidence: browser.evidence(), view: browser.view()});
      }
      const wire = JSON.parse(JSON.stringify(submitted)) as typeof submitted;
      const server = createModel2Engine(input, 10, adjust(buildModel2Contract));
      for (let second = 0; second < 10; second++) {
        for (const action of wire.filter(a => a.atSecond === second)) server.apply(action.request);
        server.advance();
        expect(server.evidence()).toEqual(snapshots[second]!.evidence);
        expect(server.view()).toEqual(snapshots[second]!.view);
      }
      const e = server.evidence(), cdn = e.systems.cdns[0]!;
      expect(cdn.purged).toBe(mode === "warm" || mode === "origin-down" ? 1 : 0);
      if (inFlight) { expect(cdn.staleFills).toBe(mode === "shared-fill" ? 1 : 4); expect(cdn.fills).toBeGreaterThan(0); }
      else expect(cdn.staleFills).toBe(0);
      if (mode === "origin-down") { expect(cdn.entries).toEqual([]); expect(e.counts.rejected).toBeGreaterThan(0); }
      else expect(cdn.hits).toBeGreaterThan(0);
      proof.push({mode, purged: cdn.purged, hits: cdn.hits, misses: cdn.misses, originRequests: cdn.originRequests, fills: cdn.fills, staleFills: cdn.staleFills, outcomes: e.counts});
    }
    console.info("cdn-purge-browser-server-parity", JSON.stringify(proof));
  } finally { for (const path of [entry, bundle]) if (await Bun.file(path).exists()) await unlink(path); }
});
