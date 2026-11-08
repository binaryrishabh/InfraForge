import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS, evidenceLabels, type LearningLesson } from "@infraforge/contracts/learning";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";

const render = (report: RunReport) => renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
async function fixture(file: string) {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, `../../backend/tests/${file}.fixture.ts`)], {stdout: "pipe", stderr: "pipe"});
  const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, errors).toBe(0);
  return JSON.parse(output);
}
const labels = Object.keys(LEARNING_REPORT_MEASUREMENTS).filter(l => l.startsWith("Cache:") || l.startsWith("Application helper:"));

test("real saved cache and helper evidence renders exact counts with separate owners, units and windows", async () => {
  const f = await fixture("cacheReport") as {lessons: Array<{old: LearningLesson; current: LearningLesson}>; reports: RunReport[]; missing: RunReport; unknown: RunReport; invalid: RunReport; checkpointOnly: RunReport};
  for (const report of f.reports) {
    const html = render(report);
    expect(html).toContain("cumulative counts from run start through this snapshot");
    expect(html).toContain("separate from original callers and final-second requests/s");
    for (const r of report.terminal!.resources) {
      if (r.cache) expect(html).toContain(`<dt>Cache: Targeting-helper coalesced waiters</dt><dd>${r.cache.coalescedWaiters}</dd>`);
      if (r.cache) for (const [key, label] of [["hits", "Hits"], ["misses", "Misses"], ["expirations", "Expirations"], ["evictions", "Evictions"]] as const) {
        expect(html).toContain(`<dt>Cache: ${label}</dt><dd>${r.cache[key]}</dd>`);
        expect(lessonRunMeasurements(report, [`Cache: ${label}`])[0]!.value).toContain(`${r.id}: ${r.cache[key]} count`);
      }
      for (const h of r.applicationHelpers?.helpers ?? []) {
        expect(html).toContain(`Helper ${h.id}`); expect(html).toContain(`Cache ${h.cacheId}; database ${h.databaseId}`);
        for (const [key, label] of [["databaseFetches", "Database fetches"], ["coalescedWaiters", "Coalesced waiters"], ["received", "Received"], ["completed", "Completed"], ["failed", "Failed"], ["live", "Live requests"], ["fillsInProgress", "Fills in progress"], ["cacheFailures", "Cache failures"], ["invalidations", "Invalidations"]] as const) {
          expect(html).toContain(`<dt>Application helper: ${label}</dt><dd>${h[key]}</dd>`);
          expect(lessonRunMeasurements(report, [`Application helper: ${label}`])[0]!.value).toContain(`${r.id} / ${h.id}: ${h[key]} count`);
        }
      }
    }
  }
  for (const {old, current} of f.lessons) {
    expect(old.contentVersion).toBe(1); expect(current.contentVersion).toBe(3);
    const newLabels = current.experiment!.evidenceToInspect!.flatMap(evidenceLabels).filter(l => l.startsWith("Cache:") || l.startsWith("Application helper:"));
    expect(newLabels).toContain("Application helper: Database fetches");
    for (const label of newLabels) expect(render(f.reports[1]!)).toContain(`<dt>${label}</dt>`);
  }
  const old = render(f.missing);
  for (const label of labels) expect(old).toContain(`<dt>${label}</dt><dd>Unknown</dd>`);
  expect(lessonRunMeasurements(f.missing, labels).every(r => /Unknown/.test(r.value))).toBe(true);
  expect(render(f.unknown)).toContain("<dt>Cache: Hits</dt><dd>Unknown</dd>");
  expect(f.invalid.terminal).toBeNull();
  expect(render(f.checkpointOnly)).toContain("Latest retained simulation checkpoint");
  expect(lessonRunMeasurements(f.checkpointOnly, labels).every(r => /Unknown/.test(r.value))).toBe(true);
}, 60000);

const timeoutLabels = ["Timed-out attempts", "Wasted completions", "Timeout cancellations requested", "Confirmed at entry", "Recovered after timeout"];
test("real saved timeout counts keep attempts, original callers and cancellation receipts distinct; legacy values show Unknown", async () => {
  const f = await fixture("timeoutReport") as {report: RunReport; old: RunReport; absent: RunReport; noTraffic: RunReport; traffic: NonNullable<RunReport["terminal"]>["traffic"]; records: {terminal: RunReport["terminal"]; checkpoint: RunReport["checkpoint"]}};
  expect(f.report.terminal!.traffic).toEqual(f.traffic);
  expect(f.records.terminal!.traffic).toEqual(f.traffic); expect(f.records.checkpoint!.traffic).toEqual(f.traffic);
  const retry = f.traffic!.clientRetry!;
  expect(retry.attemptsTimedOut!).toBeGreaterThan(0);
  expect(retry.timeoutCancellationsRequested!).toBeGreaterThan(0);
  expect(retry.timeoutCancellationsConfirmed!).toBeLessThanOrEqual(retry.timeoutCancellationsRequested!);
  expect(retry.totalAttempts).toBeGreaterThan(retry.attemptRps);
  console.info(JSON.stringify({timeoutCounters: retry, originals: f.traffic!.wholeRun}));
  expect(retry.totalAttempts).toBeGreaterThan(retry.originalsOffered);
  const html = render(f.report);
  expect(html).toContain("Counters and load factor: whole run.");
  expect(html).toContain("Attempts/s: last measured second.");
  expect(html).toContain("counts original callers");
  const summaries = lessonRunMeasurements(f.report, timeoutLabels);
  for (const [i, key] of (["attemptsTimedOut", "wastedCompletions", "timeoutCancellationsRequested", "timeoutCancellationsConfirmed", "recoveredByTimeoutRetry"] as const).entries()) {
    expect(html).toMatch(new RegExp(`>${timeoutLabels[i]}<\\/dt><dd>${retry[key]}<\\/dd>`));
    expect(summaries[i]!.value).toBe(`${retry[key]} ${i < 2 ? "attempts" : i === 2 ? "requests" : i === 3 ? "receipts" : "originals"}`);
  }
  for (const report of [f.old, f.absent, f.noTraffic]) {
    const legacy = render(report);
    for (const label of timeoutLabels) expect(legacy).toContain(`>${label}</dt><dd>Unknown</dd>`);
    expect(lessonRunMeasurements(report, timeoutLabels).every(row => row.value === "Unknown")).toBe(true);
  }
  expect(LEARNING_REPORT_MEASUREMENTS).not.toHaveProperty("Superseded outcomes");
}, 60000);
