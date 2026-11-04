import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { compareInputs } from "../comparison/inputs";
import { scalingSessionInput } from "./scalingSessions.fixture";

test("saved autoscaling ceiling exhausts shared DB sessions through the product compiler with browser/server parity", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/scaling-sessions-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text();
    if (await build.exited !== 0) throw Error(diagnostics);
    const createBrowserRun: typeof createModel2Run = (await import(pathToFileURL(browserPath).href)).createModel2Run;
    const inputs = [scalingSessionInput(1), scalingSessionInput(12)];
    expect(compareInputs(inputs[0]!, inputs[1]!)).toMatchObject({ grade: "one-change-design" });
    const outcomes = inputs.map(input => {
      expect(buildContractFromRunInputs(input, 23)).toEqual(buildContractFromRunInputs(input, 23, buildModel2Contract));
      const browser = createBrowserRun(input, 23), server = createModel2Engine(input, 23, buildModel2Contract);
      const capacity = { kind: "intervention" as const, parameters: { interventionId: "session-capacity", revision: 1, target: { resourceId: "db" }, parameters: { sessions: 12, duration: 22 } } };
      expect(browser.apply(capacity)).toEqual(server.apply(capacity));
      const rows = [];
      for (let second = 1; second <= 23; second++) {
        browser.advance(); server.advance();
        expect(browser.evidence()).toEqual(server.evidence());
        expect(browser.view()).toEqual(server.view());
        const e = browser.evidence(), db = e.data.databases[0]!;
        expect(db.sessions.total).toBeLessThanOrEqual(db.sessions.limit);
        for (const p of e.network.paths.filter(p => p.target === "db")) expect(p.pool.connections).toBeLessThanOrEqual(10);
        rows.push({ second, offered: e.counts.offered, sessions: db.sessions.total, limit: db.sessions.limit, refused: db.sessionEvents!.refused, failedRps: browser.view().traffic!.failedRps, completedRps: browser.view().traffic!.completedRps });
        if (second === 15) {
          const action = { kind: "load" as const, parameters: { targetLoadFraction: 1 / 3 } };
          expect(browser.apply(action)).toEqual(server.apply(action));
        }
      }
      return { rows, evidence: browser.evidence() };
    });
    const [one, twelve] = outcomes;
    expect(one!.rows.slice(0, 9)).toEqual(twelve!.rows.slice(0, 9));
    expect(one!.evidence.counts.offered).toBe(twelve!.evidence.counts.offered);
    expect(one!.evidence.data.databases[0]!.sessionEvents!.refused).toBe(0);
    expect(twelve!.evidence.data.databases[0]!.sessionEvents!.refused).toBeGreaterThan(0);
    expect(twelve!.evidence.data.databases[0]!.sessions.limit).toBe(one!.evidence.data.databases[0]!.sessions.limit);
    expect(twelve!.evidence.product.controllers[0]!.inService).toBe(12);
    expect(twelve!.evidence.network.loadBalancers[0]!.backends.every(b => b.selected > 0)).toBe(true);
    const relief = (r: typeof one) => r!.rows.filter(row => row.second >= 18).reduce((n, row) => n + row.failedRps, 0);
    expect(relief(twelve)).toBeGreaterThan(relief(one));
    console.info("compiled-scaling-db-sessions", JSON.stringify(outcomes.map(r => ({ rows: r.rows.filter(row => [9, 15, 18, 23].includes(row.second)), finalCounts: r.evidence.counts, inService: r.evidence.product.controllers[0]!.inService, db: r.evidence.data.databases[0]!.sessions, refused: r.evidence.data.databases[0]!.sessionEvents!.refused }))));
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
}, 180000);
