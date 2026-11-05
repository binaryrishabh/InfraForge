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
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import type { FromWorker, ToWorker } from "../src/features/model2Run/protocol";
import { createBrowserRuns } from "../src/features/model2Run/browserRuns";
import { startModel2Run } from "../src/features/model2Run/runner";
import { createRunHost } from "../src/features/model2Run/worker/host";
import { API_URL, http } from "../src/client/httpClient";
import { getLearningCatalog, getLearningLesson } from "../src/features/learning/learning.api";
import { openChallengeWorkspace, startChallengeAttempt, openImprovementWorkspace, previewImprovement } from "../src/api/challenges.api";
import { getRunReport, getComparison } from "../src/api/reports.api";
import { LessonView } from "../src/features/learning/LessonPage";
import { LearningList } from "../src/features/learning/LearningPage";
import { EMPTY_FILTERS } from "../src/features/learning/discovery";
import { LessonRunSummary } from "../src/features/learning/LessonRunSummary";
import { getLatestLessonReport } from "../src/features/learning/lessonActivityData";

// The first two journeys: the workload is built with the same helpers the run dialog calls, the
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
  // Retries and the objective exist only in the later run: the comparison says so, with the real reason and no invented zeros.
  expect(compareText).toContain("Recorded for the later run but not the earlier run. Client retries were off in that run. A direct comparison is unavailable.");
  expect(compareText).toContain("No service objective was set in that run.");
  const retryRow = comparison.traffic!.find(r => r.field === "Client retry load factor, whole run")!;
  expect(retryRow).toMatchObject({ earlier: null, delta: null });
  expect(retryRow.later).toBe(poisson!.live.at(-1)!.clientRetry!.extraLoadFactor);
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

// Extends the existing journey proof, using a loopback server and real product routes.
// The worker's message transport is in-process; the engine, browser controller,
// HTTP submission and independent server replay are real. This is not DOM automation
// or proof of database persistence / production authentication.
test("lesson -> prediction -> browser attempt -> server replay -> factual progress -> improve -> compare", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/journeyProof.fixture.ts")], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, JOURNEY_INPUT: JSON.stringify({ learning: true }) } });
  const stderr = new Response(child.stderr).text(), reader = child.stdout.getReader();
  const previous = http.defaults.adapter;
  try {
    let line = "";
    while (!line.includes("\n")) { const chunk = await reader.read(); if (chunk.done) throw Error(`Journey server did not start: ${await stderr}`); line += new TextDecoder().decode(chunk.value); }
    const { url } = JSON.parse(line) as { url: string };
    expect(new URL(url).hostname).toBe("127.0.0.1");
    expect((await fetch(`${url}/learning`)).status).toBe(401);
    let cookie = "journey=alice";
    const requests: Array<{ path: string; method: string; body: unknown; status: number }> = [];
    // A network adapter only: never supply response payloads or outcomes here.
    http.defaults.adapter = async (config) => {
      expect(config.withCredentials).toBe(true);
      const target = new URL(config.url!.replace(API_URL, url));
      // A changed client URL must never send test traffic/cookies outside this fixture.
      if (target.origin !== new URL(url).origin) throw Error(`Non-local journey request refused: ${target.origin}`);
      for (const [key, value] of Object.entries(config.params ?? {})) if (value !== undefined) target.searchParams.set(key, String(value));
      const response = await fetch(target, { method: config.method?.toUpperCase(),
        headers: { cookie, "Content-Type": "application/json" }, body: config.data as string | undefined });
      const data = await response.json();
      requests.push({ path: target.pathname, method: config.method!, body: config.data ? JSON.parse(config.data as string) : null, status: response.status });
      if (!response.ok) throw Object.assign(Error(data.message), { response: { status: response.status } });
      return { data, status: response.status, statusText: response.statusText, config, headers: {} };
    };
    const ready = <T,>(data: T) => ({ data, loading: false, error: null, retry() {} });
    const lessonId = "where-does-the-time-go";
    let catalog: LearningCatalog = await getLearningCatalog(), detail: LearningLessonDetail = await getLearningLesson(lessonId);
    expect(detail.progress).toMatchObject({ activity: "not-started", attempts: 0 });
    const lessonMarkup = () => renderToStaticMarkup(<MemoryRouter><LessonView {...ready(detail)} catalog={ready(catalog)} /></MemoryRouter>);
    expect(lessonMarkup()).toContain("Open challenge lab");
    expect(lessonMarkup()).toContain(detail.lesson.experiment!.prediction!);
    const workspace = await openChallengeWorkspace(detail.challenge!.id);
    await expect(startChallengeAttempt(detail.challenge!.id, workspace.designId, { answers: {}, reasoning: null })).rejects.toThrow();
    expect((await getLearningLesson(lessonId)).progress?.attempts).toBe(0);
    const prediction = { answers: { busiest: "Virtual Machine" }, reasoning: "The starter app has more assumed CPU work per request." };
    const first = await startChallengeAttempt(detail.challenge!.id, workspace.designId, prediction);
    const wait = async <T,>(read: () => Promise<T>, done: (value: T) => boolean) => {
      const until = Date.now() + 30000;
      while (Date.now() < until) { const value = await read(); if (done(value)) return value; await new Promise((r) => setTimeout(r, 30)); }
      throw Error("Journey state did not settle");
    };
    const shown = new Map<string, NonNullable<SimulationSnapshot["traffic"]>>();
    const browsers = createBrowserRuns({ http, apiUrl: API_URL, startRun: (start, callbacks) =>
      startModel2Run(start, callbacks, () => {
        // Same host and runner as the Web Worker; only its message port and timers are seams.
        const worker = { onmessage: null as ((event: MessageEvent<FromWorker>) => void) | null, onerror: null,
          postMessage: (message: ToWorker) => host.handle(message), terminate() {} };
        const host = createRunHost((data) => {
          if (data.type === "second" && data.view.traffic) shown.set(start.challengeId!, data.view.traffic);
          worker.onmessage?.({ data } as MessageEvent<FromWorker>);
        }, { set: (fn) => setTimeout(fn, 0), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) });
        return worker as never;
      }) });
    const finish = async (id: string) => {
      await wait(async () => (await http.get(`${API_URL}/deployments/${id}`)).data.deployment.status as string, (status) => status === "browser");
      await new Promise<void>((resolveEnd, reject) => {
        void browsers.startBrowserRun(id, (error) => error ? reject(Error(error)) : resolveEnd()).catch(reject);
      });
      const report = await wait(() => getRunReport(id), (r) => r.run.status === "torn-down");
      expect(report.terminal?.traffic).toEqual(shown.get(detail.challenge!.id));
      expect(report.terminal?.simulatedSeconds).toBe(detail.challenge!.evaluationSeconds);
      const submissions = requests.filter((r) => r.path.endsWith(`/${id}/submit`) && r.status === 202);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]!.body).toEqual({ stopAtSecond: detail.challenge!.evaluationSeconds, actions: [] });
      return report;
    };
    detail = await getLearningLesson(lessonId);
    expect(detail.progress).toMatchObject({ activity: "attempted", predictionReviewed: false, attempts: 1 });
    expect((await getRunReport(first.id)).terminal).toBeNull();
    expect(lessonMarkup()).toContain("Server activity: Recorded attempt");
    await expect(http.post(`${API_URL}/deployments/${first.id}/submit`, { stopAtSecond: 12, actions: [], metrics: { healthy: true } })).rejects.toThrow();
    expect((await getRunReport(first.id)).terminal).toBeNull();
    expect((await getLearningLesson(lessonId)).progress).toMatchObject({ activity: "attempted", predictionReviewed: false, sameConditionsComparison: false });
    const before = await finish(first.id);
    expect(before.challenge?.status).toBe("not-met");
    expect(before.challenge?.reasoning).toBe(prediction.reasoning);
    await expect(http.post(`${API_URL}/deployments/${first.id}/submit`, { stopAtSecond: 12, actions: [] })).rejects.toThrow();
    detail = await getLearningLesson(lessonId);
    expect(detail.progress).toMatchObject({ activity: "attempted", predictionReviewed: true, attempts: 1 });
    const improved = await openImprovementWorkspace(detail.challenge!.id, first.id);
    const layout = structuredClone(improved.layout)!;
    layout.resources!.find((r) => r.id === "app")!.skuId = "c5.large";
    const review = await previewImprovement(detail.challenge!.id, first.id, improved.id, layout);
    expect(review).toMatchObject({ count: 1, classification: "one-change" });
    await http.put(`${API_URL}/infrastructure/${improved.id}`, { layout });
    const hypothesis = "I expect the app size change to reduce app CPU at second 12.";
    const second = await startChallengeAttempt(detail.challenge!.id, improved.id, { answers: { busiest: "Database" }, reasoning: "A new expectation after changing the app." },
      { sourceRunId: first.id, hypothesis, intent: "improvement", inputHash: review.inputHash!, acknowledgeMultiple: false }, detail.challenge!.version);
    expect((await getLearningLesson(lessonId)).progress).toMatchObject({ activity: "attempted", attempts: 2, sameConditionsComparison: false });
    const after = await finish(second.id);
    expect(after.challenge?.status).toBe("met");
    expect(after.run.learning).toMatchObject({ sourceRunId: first.id, hypothesis, intent: "improvement" });
    const comparison = await getComparison(first.id, second.id);
    expect(comparison).toMatchObject({ available: true, challengeConditions: "same", lineage: "source-and-improvement", designChangeReview: { count: 1 } });
    expect(compareText(comparison)).toContain("Traffic outcomes");
    catalog = await getLearningCatalog(); detail = await getLearningLesson(lessonId);
    expect(detail.progress).toMatchObject({ activity: "requirements-met", attempts: 2, predictionReviewed: true, sameConditionsComparison: true, lastRunId: second.id });
    expect(catalog.progress.find((p) => p.lessonId === lessonId)).toEqual(detail.progress!);
    expect(lessonMarkup()).toContain("Current requirements met");
    const latest = (await getLatestLessonReport(detail))!;
    expect(latest.run.id).toBe(second.id);
    const summary = text(renderToStaticMarkup(<LessonRunSummary report={latest} lesson={detail.lesson} />));
    expect(summary).toContain("What did my run show?");
    expect(summary).toContain(`Run ${second.id}`);
    expect(summary).not.toContain(`Run ${first.id}`);
    expect(summary).toContain(`p95 ${after.terminal!.traffic!.latencyMs.p95} ms`);
    expect(summary).toContain(`Completed requests/s ${after.terminal!.traffic!.completedRps}`);
    expect(summary).toContain("Requirements: Met");
    const list = renderToStaticMarkup(<MemoryRouter><LearningList {...ready(catalog)} filters={EMPTY_FILTERS} onFilters={() => {}} /></MemoryRouter>);
    expect(list).toContain("Current requirements met");
    cookie = "journey=bob";
    const otherOwner = await getLearningLesson(lessonId);
    expect(otherOwner.progress).toMatchObject({ activity: "not-started", attempts: 0, lastRunId: null });
    expect(await getLatestLessonReport(otherOwner)).toBeNull();
    await expect(getLatestLessonReport(detail)).rejects.toThrow();
    await expect(getRunReport(first.id)).rejects.toThrow();
    await expect(getComparison(first.id, second.id)).rejects.toThrow();
    console.info("learning-journey", JSON.stringify({ source: before.challenge?.status, later: after.challenge?.status,
      activity: detail.progress?.activity, attempts: detail.progress?.attempts, httpRequests: requests.length, serverReplay: true }));
  } finally {
    http.defaults.adapter = previous;
    child.kill(); await child.exited; await reader.cancel();
    expect(await stderr).toBe("");
  }
}, 180000);
