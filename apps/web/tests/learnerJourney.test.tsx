import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunComparison, RunReport } from "@infraforge/contracts/reports";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
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
const controlledSource = { ...base, targetThroughput: 36000 };
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

// Controlled experiment: the second run is built by the same server function that creates a traffic experiment.
test("a controlled traffic experiment compares a source run with one changed setting and states what it can and cannot show", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/journeyProof.fixture.ts")], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, JOURNEY_INPUT: JSON.stringify({ source: controlledSource, seconds: 6,
      variants: [{ dimension: "arrival-process", value: "poisson" }, { dimension: "application-cpu-variability", value: "moderate" }] }) } });
  const output = await new Response(child.stdout).text(), diagnostics = await new Response(child.stderr).text();
  if (await child.exited !== 0) throw Error(diagnostics);
  const { runs, comparisons } = JSON.parse(output) as { runs: Array<{ report: RunReport; evidence: { counts: { offered: number } } }>; comparisons: RunComparison[] };
  const [arrival, work] = comparisons as [RunComparison, RunComparison];
  for (const c of comparisons) {
    expect(c.starting.grade).toBe("one-change-workload");
    expect(c.lineage).toBe("source-and-rerun");
    expect(c.headline).toBe("matched-pair");
    expect(c.evidence.matchedDuration).toBe(true);
    expect(c.starting.facets).toMatchObject({ seed: "same", topology: "same", model: "same", catalog: "same", workload: "different" });
    const text = compareText(c);
    expect(text).not.toContain("Exact rerun");
    for (const phrase of ["Traffic outcomes", "Configured target rate (starting input)", "Original requests offered, whole run", "The same seed does not mean identical",
      "one pair, one seed", "Another seed may differ"]) expect(text).toContain(phrase);
  }
  expect(runs[1]!.report.run.rerunMode).toBe("workload-variant");
  expect(compareText(arrival)).toContain("identical random draws or identical offered requests when the arrival process differs");
  expect(compareText(work)).toContain("identical service times when application work variability differs");
  expect(compareText(work)).not.toContain("when the arrival process differs");
  expect(compareText(arrival)).toContain("Arrival process: even → poisson");
  // The verdict block names the change in the learner's words, before any detail.
  expect(compareText(arrival)).toContain("Changed between the runs Arrival pattern: Even → Random (Poisson)");
  expect(compareText(work)).toContain("Changed between the runs Application work variability: Fixed (CV 0) → Moderate (CV 0.5)");
  expect(compareText(work)).toContain("Application CPU variability: fixed (CV 0) → moderate (CV 0.5)");
  // Configured and observed traffic stay separate: the target rate is identical, the sampled originals are not.
  const rows = new Map(arrival.traffic!.map(r => [r.field, r]));
  expect(rows.get("Configured target rate (starting input)")).toMatchObject({ earlier: 600, later: 600, delta: 0 });
  const offered = rows.get("Original requests offered, whole run")!;
  expect(offered.earlier).toBe(runs[0]!.evidence.counts.offered); expect(offered.later).toBe(runs[1]!.evidence.counts.offered);
  expect(offered.delta).toBe(offered.later! - offered.earlier!);
  console.info("controlled-experiment", JSON.stringify({ configuredRps: 600, offered: [offered.earlier, offered.later],
    rows: arrival.traffic!.map(r => [r.field, r.earlier, r.later, r.delta]), cpuRows: work.traffic!.map(r => [r.field, r.earlier, r.later, r.delta]) }));
}, 180000);

function compareText(data: RunComparison) {
  return text(renderToStaticMarkup(<MemoryRouter><CompareContent loading={false} error={null} retry={() => {}} data={data} /></MemoryRouter>));
}
