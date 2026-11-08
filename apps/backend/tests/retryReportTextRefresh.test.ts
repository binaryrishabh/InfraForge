import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { learningMeasurement } from "@infraforge/contracts/learning";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { validateLearningContent } from "../learning/validate";
import { checkLearningAuthoring } from "../learning/authoring";
import { buildRunReport } from "../reports/report";
import { LbAccountingSchema } from "../reports/lbAccountingSchema";
import { definition } from "./challengeHarness";
import { resilienceFixture } from "./lbResilienceReport.fixture";

const id = "retry-limits-and-budgets";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const old = LEARNING_REGISTRY.findLesson(id, 1)!, current = LEARNING_REGISTRY.findLesson(id)!;
const labels = ["Active retries (current attempts)", "Reserved backoffs (current calls)", "Suppressed: retry budget (cumulative calls)"];

test("retry guidance changes only the false saved-report limitation through a new content version", () => {
  expect(createHash("sha256").update(source("../learning/content/depth/lessons/retry-limits-and-budgets.ts")).digest("hex"))
    .toBe("ab7cbb6faa4c9f02c6cb1e209f8c327ece77ac2dfb24ed7011287bcc23e28b9c");
  expect(old.contentVersion).toBe(1); expect(current.contentVersion).toBe(2);
  expect(current).toEqual({...old, contentVersion: 2, limitations: [current.limitations[0]!, ...old.limitations.slice(1)]});
  expect(current.limitations[0]).not.toBe(old.limitations[0]);
  expect(old.limitations[0]).toContain("saved reports omit those fields");
  for (const label of labels) {
    expect(current.limitations[0]).toContain(label);
    const measurement = learningMeasurement(label)!;
    expect(measurement).not.toBeNull();
    expect(source(`../../../${measurement.source}`)).toContain(measurement.marker);
  }
  expect(current.limitations[0]).toContain("Missing historical fields stay Unknown");
  expect(current.limitations[0]).toContain("requirement scores amplification; suppression reasons are separate diagnostics");
  expect(current.experiment).toBeNull();
  expect(learningContent.archivedLessons).toContainEqual(old);
  expect(LEARNING_REGISTRY.listLessons().filter(l => l.id === id)).toEqual([current]);
  expect(LEARNING_REGISTRY.findLesson(id, 3)).toBeNull();
  const copy = LEARNING_REGISTRY.findLesson(id, 1)!; copy.limitations[0] = "changed";
  expect(LEARNING_REGISTRY.findLesson(id, 1)).toEqual(old);
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
});

test("the narrower LB accounting omission remains true and its published lesson stays current", () => {
  const ownership = LEARNING_REGISTRY.findLesson("retry-ownership-across-layers")!;
  expect(ownership.contentVersion).toBe(1);
  expect(ownership.limitations[0]).toContain("Saved LB accounting does not identify concurrent-budget suppression reasons.");
  const accounting = {profile: "lb-accounting/1", rejectedAtLb: 0, queuedAtLb: 0,
    acceptedByBackend: 0, queuedAtVm: 0, rejectedByVm: 0, timedOutDownstream: 0};
  expect(LbAccountingSchema.safeParse(accounting).success).toBe(true);
  expect(LbAccountingSchema.safeParse({...accounting, suppressedByReason: {budget: 0}}).success).toBe(false);
  expect(source("../../web/src/features/reports/components/LbAccountingReadings.tsx")).not.toContain(labels[2]!);
});

test("corrected labels render retained real retry counters while missing historical evidence stays Unknown", async () => {
  const d = definition("retrying-a-full-pool"), design = structuredClone(d.starter!);
  design.resources.find(r => r.id === "lb")!.retry!.maxConcurrentRetries = 4;
  design.resources.find(r => r.id === "lb")!.retry!.backoffMs = 100;
  const fixture = resilienceFixture(d, design), last = fixture.samples.at(-1)!;
  const retry = fixture.report.terminal!.resources.find(r => r.id === "lb")!.lbRetry!;
  expect(retry).toEqual(last.metrics.lbRetry!);
  expect(retry.suppressedByReason.budget).toBeGreaterThan(0);
  expect(fixture.samples.some(s => s.metrics.lbRetry!.activeRetries > 0)).toBe(true);
  expect(fixture.samples.some(s => s.metrics.lbRetry!.retriesWaiting > 0)).toBe(true);
  const historical = structuredClone(fixture.row);
  delete (historical.terminalSnapshot as SimulationSnapshot).metrics.lb!.lbRetry;
  const absent = buildRunReport(historical);
  expect(absent.terminal!.resources.find(r => r.id === "lb")!.lbRetry).toBeUndefined();
  const malformed = structuredClone(fixture.row);
  (malformed.terminalSnapshot as SimulationSnapshot).metrics.lb!.lbRetry!.activeRetries = -1;
  const refused = buildRunReport(malformed);
  expect(refused.terminal).toBeNull();
  expect(refused.unknown.join(" ")).toContain("terminal record is malformed");
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement as h} from "react";
    import {renderToStaticMarkup} from "react-dom/server";
    import {ReportMeasurements} from "./src/features/reports/components/ReportMeasurements";
    console.log(JSON.stringify((await Bun.stdin.json()).map(report => renderToStaticMarkup(h(ReportMeasurements, {report, number:1})))));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify([fixture.report, absent])); child.stdin.end();
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({code, stderr}).toEqual({code: 0, stderr: ""});
  const [html, oldHtml] = JSON.parse(stdout) as string[];
  const values = [retry.activeRetries, retry.retriesWaiting, retry.suppressedByReason.budget];
  for (const [index, label] of labels.entries()) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(html).toMatch(new RegExp(`<dt>${escaped}</dt><dd[^>]*>${values[index]!.toLocaleString()}</dd>`));
    expect(oldHtml).toMatch(new RegExp(`<dt>${escaped}</dt><dd[^>]*>Unknown</dd>`));
  }
  console.info("Retry guidance saved evidence", JSON.stringify({version: current.contentVersion, sampleTimeUs: retry.sampledAtUs,
    active: retry.activeRetries, backoffs: retry.retriesWaiting, budgetSuppressed: retry.suppressedByReason.budget,
    historical: absent.terminal!.resources.find(r => r.id === "lb")!.lbRetry ?? null}));
}, 60000);
