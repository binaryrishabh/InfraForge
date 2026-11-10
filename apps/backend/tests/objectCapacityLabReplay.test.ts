import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition, REFERENCE } from "./challengeHarness";

test("object capacity lab: browser-target replay matches server every second, including spare producer CPU and byte admission", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/object-capacity-lab-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text();
    if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    const d = definition("object-bytes-versus-app-cpu"), near = structuredClone(d.starter!);
    near.resources.find(r => r.id === "app")!.size = "large";
    const maxCpu: number[] = [];
    for (const design of [d.starter!, REFERENCE[d.id]!, near]) {
      const captured = captureRunInputs(design, d.workload, challengeSeed(d));
      const input = readRunInputs(JSON.parse(JSON.stringify(captured))); expect(input).toEqual(captured);
      // Both use the ordinary saved-input compiler; no diagnostic commands or contract edits.
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
      let maximum = 0;
      for (let second = 1; second <= d.evaluationSeconds; second++) {
        browser.advance(); server.advance();
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        const view = server.view(), store = server.evidence().asynchronous.objects[0]!;
        const cpu = view.metrics.app!.cpu;
        if (cpu === null) throw Error("Producer CPU was not recorded");
        maximum = Math.max(maximum, cpu);
        expect(cpu).toBeLessThan(20);
        expect(store.storedBytes).toBeLessThanOrEqual(store.capacityBytes!);
        expect(store.storedBytes).toBe(store.objects.reduce((sum, o) => sum + o.bytes, 0));
        expect(store.puts).toBe(store.committedPuts + (store.service.reasons["object-capacity"] ?? 0));
        expect(view.metrics.store!.objectStorage).toMatchObject({storedBytes: store.storedBytes, puts: store.puts, committedPuts: store.committedPuts,
          "object-capacity": store.service.reasons["object-capacity"] ?? null});
      }
      // Exact replay from the same captured input must reproduce both outcomes and engine evidence.
      const repeat = createModel2Engine(input, d.evaluationSeconds);
      for (let second = 1; second <= d.evaluationSeconds; second++) repeat.advance();
      expect(repeat.view()).toEqual(server.view()); expect(repeat.evidence()).toEqual(server.evidence());
      maxCpu.push(maximum);
    }
    expect(maxCpu).toEqual([14.4, 14.4, 3.6]);
    console.info("object-capacity-lab-parity", JSON.stringify({cases: 3, secondsEach: 30, repeatedCases: 3, maxAppCpu: maxCpu}));
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 120000);
