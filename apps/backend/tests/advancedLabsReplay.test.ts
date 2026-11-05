import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { recordedScenario } from "../challenges/scenario";
import { definition, REFERENCE } from "./challengeHarness";

test("advanced labs: browser and server agree on every tick, exact multi-step receipts and raw mechanisms", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/advanced-labs-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["diagnose-lost-app-capacity", "investigate-a-pool-reset", "budget-for-a-partition", "trace-a-saturation-cascade"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!, ...(id === "budget-for-a-partition" ? [REFERENCE[`${id}-headroom`]!] : [])]) {
        const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds), scenario = recordedScenario(d, input);
        let next = 0;
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          for (const step of scenario?.steps.filter(s => s.atSecond === second) ?? []) {
            const a = browser.apply({kind: "intervention", parameters: step.request}), b = server.apply({kind: "intervention", parameters: step.request});
            expect(a).toEqual(b); expect(a.outcome.intervention).toEqual(scenario!.receipts[next++]!);
            while (browser.catchingUp) browser.catchUp(10);
            while (server.catchingUp) server.catchUp(10);
          }
          expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
          if (id === "investigate-a-pool-reset") {
            const active = server.view().activeChaos;
            // Calibration telemetry proves the reset did not cancel the CPU fault.
            // The saved report has no such intermediate series; the lesson preserves that gap.
            if (second === 2) expect(active).toEqual([]); // The script starts one microsecond after tick 2.
            if (second >= 3 && second <= 5) expect(active.some(a => a.resourceId === "db")).toBe(true);
            if (second === 6) expect(active).toEqual([]);
          }
          if (id === "diagnose-lost-app-capacity") {
            const security = server.evidence().systems.security, policy = security.policies.find(p => p.id === "fw")!;
            expect(server.view().metrics.fw!.security!.firewall).toMatchObject({occupancy: policy.flows.length, admissions: policy.opened, "flow-capacity": policy.capacityRefused, policyDenied: policy.denied});
            const peer = server.evidence().network.loadBalancers[0]!.backends.find(b => b.id === "peer")!;
            expect(peer.health).toBe(design.resources.find(r => r.id === "fw")!.firewallCapacity!.maxFlows > 1);
            if (design === d.starter) expect(peer.selected).toBe(0);
          }
        }
        expect(next).toBe(scenario?.steps.length ?? 0);
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
