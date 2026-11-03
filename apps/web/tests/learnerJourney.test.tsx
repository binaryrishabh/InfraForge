import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunComparison, RunReport } from "@infraforge/contracts/reports";
import type { SimulationSnapshot } from "@infraforge/contracts/simulation";
import { WORKLOAD_PRESETS, withClientRetry, withObjective, withWorkloadDynamics } from "../src/features/deployment/workloadOptions";
import { TrafficReadings } from "../src/features/live/TrafficReadings";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { SourceInputFacts } from "../src/features/reports/components/SourceInputFacts";
import { CompareContent } from "../src/features/reports/components/CompareView";

// Learner journey with real parts: the workload is built with the same helpers the run dialog calls, the
// product-compiled engine runs it, and the live panel, the stored report and the comparison are rendered
// from that engine's output. Sign-in, the canvas and the network are NOT part of this proof.
const base = { ...WORKLOAD_PRESETS[0]!.profile, targetThroughput: 72000, throughputUnit: "per-minute" as const, readWriteRatio: 1, payloadSize: "light" as const };
const steady = base;
const random = withObjective(withClientRetry(withWorkloadDynamics(withWorkloadDynamics(base, { arrivalProcess: "poisson" }), { applicationCpuCv: 0.5 }), 3, 50, 20),
  { maxResponseMs: 20, targetSuccessPercent: 95 });

type Live = NonNullable<SimulationSnapshot["traffic"]>;
interface Journey { runs: Array<{ live: Live[]; report: RunReport }>; comparison: RunComparison }
async function journey(): Promise<Journey> {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/journeyProof.fixture.ts")], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, JOURNEY_INPUT: JSON.stringify({ profiles: [steady, random], seconds: 6 }) } });
  const output = await new Response(child.stdout).text(), diagnostics = await new Response(child.stderr).text();
  if (await child.exited !== 0) throw Error(diagnostics);
  return JSON.parse(output) as Journey;
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const live = (traffic: Live | undefined) => {
  const initial = useSimulationStore.getInitialState(), previous = initial.traffic;
  try { initial.traffic = traffic; return renderToStaticMarkup(<TrafficReadings />); } finally { initial.traffic = previous; }
};

test("a learner's random-traffic run shows the same engine numbers live, in the report and in the comparison", async () => {
  const { runs, comparison } = await journey();
  const [even, poisson] = runs;
  const finalLive = poisson!.live.at(-1)!, evenLive = even!.live.at(-1)!;

  // Live: the panel reads exactly what the engine view carries.
  const liveText = text(live(finalLive));
  expect(finalLive.latencyMs.p99).toBeDefined();
  for (const p of ["p50", "p95", "p99"] as const) expect(liveText).toContain(`${finalLive.latencyMs[p]} ms`);
  expect(finalLive.clientRetry?.attemptsTimedOut).toBeDefined();
  expect(liveText).toContain("Timed-out attempts");
  expect(liveText).toMatch(/Objective|objective/);
  expect(liveText).toContain("Whole run");
  // The even/fixed run has no retry or objective block, and the panel does not invent one.
  expect(evenLive.clientRetry).toBeUndefined();
  expect(text(live(evenLive))).not.toContain("Timed-out attempts");

  // Report: the stored terminal capture renders the same numbers; the source settings are recorded.
  const terminal = poisson!.report.terminal!;
  expect(terminal.traffic).toEqual(JSON.parse(JSON.stringify(finalLive)));
  const reportText = text(renderToStaticMarkup(<ReportMeasurements report={poisson!.report} number={1} />));
  for (const p of ["p50", "p95", "p99"] as const) expect(reportText).toContain(`${terminal.traffic!.latencyMs[p]} ms`);
  expect(reportText).toContain("Last measured second before the run stopped");
  const facts = text(renderToStaticMarkup(<SourceInputFacts workload={poisson!.report.run.workload!} seed="learner-journey-seed" />));
  for (const phrase of ["Poisson arrivals", "Variable app CPU: Moderate (CV 0.5)", "learner-journey-seed"]) expect(facts).toContain(phrase);

  // Comparison: unlike runs are described honestly, and nothing is called an exact rerun.
  // Turning retries on changes the captured adapter profiles, so this pair is descriptive only, and says why.
  expect(comparison.starting.grade).toBe("side-by-side-only");
  expect(comparison.starting.compatibilityReason).toContain("adapter profile");
  const compareText = text(renderToStaticMarkup(<MemoryRouter><CompareContent loading={false} error={null} retry={() => {}} data={comparison} /></MemoryRouter>));
  expect(compareText).toContain("Traffic outcomes");
  expect(compareText).not.toContain("Exact rerun");
  console.info("learner-journey", JSON.stringify({ grade: comparison.starting.grade, headline: comparison.headline, lineage: comparison.lineage,
    evenLast: evenLive.latencyMs, poissonLast: finalLive.latencyMs, poissonRetry: finalLive.clientRetry, objective: finalLive.objective?.status,
    trafficRows: comparison.traffic?.map(r => [r.field, r.earlier, r.later, r.delta, r.withheldReason ?? null]) }));
}, 180000);
