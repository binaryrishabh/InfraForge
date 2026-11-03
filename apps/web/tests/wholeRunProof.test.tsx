import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { CompareMetric, ReportCheckpoint } from "@infraforge/contracts/reports";
import { TrafficEvidence } from "../src/features/live/TrafficEvidence";
import { CompareMetrics } from "../src/features/reports/components/CompareMetrics";

test("Poisson timeout comparison carries independent whole-run ranks from terminal storage into report markup", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/wholeRunProof.fixture.ts")], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text(), diagnostics = await new Response(child.stderr).text();
  if (await child.exited !== 0) throw Error(diagnostics);
  const proof = JSON.parse(output) as { runs: Array<{ timeout: number; terminal: ReportCheckpoint; exactP99Ms: number; attemptsTimedOut: number }>; comparison: CompareMetric[] };
  for (const run of proof.runs) {
    const w = run.terminal.traffic!.wholeRun!, bound = w.percentiles.p99!;
    expect(w.completed).toBeGreaterThanOrEqual(100);
    expect(bound.highMs).toBeGreaterThanOrEqual(run.exactP99Ms);
    expect(bound.highMs / run.exactP99Ms).toBeLessThanOrEqual(1.032);
    if (run.timeout === 5) expect(run.attemptsTimedOut).toBeGreaterThan(0);
    else expect(run.attemptsTimedOut).toBe(0);
    const html = renderToStaticMarkup(<TrafficEvidence traffic={run.terminal.traffic} recordedAt="stop" />);
    expect(html).toContain("Whole run (through second 4)"); expect(html).toContain(`${bound.highMs} ms (within 3%)`);
    expect(html).toContain("Last measured second before the run stopped");
    console.info("whole-run-window-proof", JSON.stringify({ timeoutMs: run.timeout, wholeRunUpperMs: Object.fromEntries(Object.entries(w.percentiles).map(([p, b]) => [p, b?.highMs ?? null])), lastSecondMs: run.terminal.traffic!.latencyMs, exactWholeRunP99Ms: run.exactP99Ms }));
  }
  expect(proof.comparison.filter(m => m.field.includes("upper bucket bound"))).toHaveLength(3);
  expect(proof.comparison.every(m => m.delta !== null)).toBe(true);
  const html = renderToStaticMarkup(<CompareMetrics metrics={proof.comparison} caption="Traffic outcomes" />);
  expect(html).toContain("p99 response time, whole run (upper bucket bound, within 3%)");
}, 180000);
