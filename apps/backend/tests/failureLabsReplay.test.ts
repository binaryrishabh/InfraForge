import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { recordedScenario } from "../challenges/scenario";
import { definition, REFERENCE } from "./challengeHarness";

test("failure labs retain the same security, traffic and incident evidence in browser and server", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/failure-labs-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const id of ["find-the-denying-rule", "leave-room-for-firewall-flows", "choose-a-retry-mitigation"]) {
      const d = definition(id);
      for (const design of [d.starter!, REFERENCE[id]!]) {
        const captured = captureRunInputs(design, d.workload, challengeSeed(d)), input = readRunInputs(JSON.parse(JSON.stringify(captured)));
        expect(input).toEqual(captured);
        const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds, buildModel2Contract), scenario = recordedScenario(d, input);
        for (let second = 1; second <= d.evaluationSeconds; second++) {
          browser.advance(); server.advance();
          for (const step of scenario?.steps.filter(s => s.atSecond === second) ?? []) {
            const a = browser.apply({kind: "intervention", parameters: step.request}), b = server.apply({kind: "intervention", parameters: step.request});
            expect(a).toEqual(b); expect(a.outcome.intervention).toEqual(scenario!.receipts[0]);
            while (browser.catchingUp) browser.catchUp(10);
            while (server.catchingUp) server.catchUp(10);
          }
          expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
          if (id === "choose-a-retry-mitigation" && second === 4) expect(server.view().activeChaos.length).toBeGreaterThan(0);
          if (id === "choose-a-retry-mitigation" && second === 5) expect(server.view().activeChaos).toEqual([]);
        }
        if (id !== "choose-a-retry-mitigation") {
          const evidence = server.evidence().systems.security, measured = server.view().metrics.fw!.security!.firewall!;
          const policy = evidence.policies.find(p => p.id === "fw")!;
          expect(measured).toMatchObject({occupancy: policy.flows.length, policyDenied: policy.denied, "flow-capacity": policy.capacityRefused, expired: policy.expired});
          expect(measured.admissions).toBe(policy.opened);
        }
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
