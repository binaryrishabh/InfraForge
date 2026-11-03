import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RerunOptions, StartingComparison } from "@infraforge/contracts/reports";
import { TrafficChangeChoices, TrafficExperimentDialog, TrafficExperimentForm } from "../src/features/reports/components/TrafficExperimentDialog";
import { HistoryContent } from "../src/features/reports/components/RunList";
import { RERUN_LABEL, RERUN_SENTENCE, runKind } from "../src/features/reports/runKind";
import { SAME_SEED_NOTE, UNCHANGED, describeVariantChange, experimentSubmission, variantGroups } from "../src/features/reports/trafficExperiment";

const preview = { grade: "one-change-workload", facets: { inputVersion: "same", model: "same", catalog: "same", workload: "different", seed: "same", topology: "same", resourceOrder: "same" },
  alignment: { code: "unknown", aligned: [], shifted: [], scope: "Shared captured starting resources only." }, design: null,
  workload: [] } as unknown as StartingComparison;
const hash = "a".repeat(64);
const choice = (dimension: string, value: string, extra: object = {}) => ({ variant: { dimension, value }, available: true, reason: null, preview, inputHash: hash, ...extra });
const taken = { available: false, reason: "Already the source setting.", preview: null, inputHash: null };
const variants = { available: true, reason: null, source: { arrivalProcess: "even", applicationCpuVariability: "fixed" }, choices: [
  choice("arrival-process", "even", taken), choice("arrival-process", "poisson"),
  choice("application-cpu-variability", "fixed", taken), choice("application-cpu-variability", "moderate"),
  choice("application-cpu-variability", "high", { available: false, reason: "Not supported for this run.", preview: null, inputHash: null }),
] } as unknown as RerunOptions["workloadVariant"];
const options: RerunOptions = { source: { id: "source", infrastructureId: null, infrastructureName: "Source design", status: "torn-down", createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z", resourceCount: 2, workload: null, workloadSource: "captured", chaosEventCount: 0, topologyRevision: 0, hasReportData: true },
  workload: { targetThroughput: 72000, throughputUnit: "per-minute", payloadSize: "light", trafficShape: "steady" }, seed: "captured-seed",
  exact: { available: true, reason: null }, currentDesign: { available: false, reason: "Original design deleted", preview: null, inputHash: null, modelCatalogCompatible: false },
  workloadVariant: variants, matchedStop: { available: true, target: 620, defaultEnabled: true, reason: null } };
const render = (v: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{v}</MemoryRouter>);

test("settings are grouped by dimension with the source value named, and the server's refusals stay visible", () => {
  const groups = variantGroups(variants);
  expect(groups.map(g => [g.legend, g.current])).toEqual([["Arrival pattern", "Even"], ["Application work variability", "Fixed (CV 0)"]]);
  expect(groups[0]!.choices.map(c => [c.label, c.isCurrent, c.available])).toEqual([["Even", true, false], ["Random (Poisson)", false, true]]);
  const html = render(<TrafficChangeChoices options={variants} selected="arrival-process:poisson" onSelect={() => {}} />);
  expect(html.match(/name="traffic-change"/g)).toHaveLength(5);
  expect(html.match(/disabled=""/g)).toHaveLength(3);
  for (const text of ["current setting", "Not supported for this run.", "source run: Even", "source run: Fixed (CV 0)"]) expect(html).toContain(text);
  expect(html.match(/ checked=""/g)).toHaveLength(1);
});

test("exactly one available setting is required, and the change is named in words", () => {
  expect(experimentSubmission(variants, null, null)).toMatchObject({ ready: false, reason: "Choose one setting to change before starting." });
  expect(experimentSubmission(variants, "application-cpu-variability:high", null)).toMatchObject({ ready: false, reason: "Not supported for this run." });
  expect(experimentSubmission(variants, "arrival-process:poisson", "Run limit reached.")).toMatchObject({ ready: false, reason: "Run limit reached." });
  const ok = experimentSubmission(variants, "arrival-process:poisson", null);
  expect(ok.ready).toBe(true); expect(ok.choice?.inputHash).toBe(hash);
  expect(describeVariantChange(variants, { dimension: "application-cpu-variability", value: "moderate" })).toEqual({ dimension: "Application work variability", from: "Fixed (CV 0)", to: "Moderate (CV 0.5)" });
});

test("the form says what stays the same, warns that the same seed is not the same requests, and cannot start without a choice", () => {
  const html = render(<TrafficExperimentForm id="source" options={options} close={() => {}} onBusy={() => {}} />);
  for (const line of [...UNCHANGED, "Choose the one setting to change.", "Run with this change", "Stop automatically at the same simulated time as the source run", "(620 s)", "captured-seed"]) expect(html).toContain(line);
  expect(html).toContain("The same seed does not mean the same requests.");
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/);
  expect(html).toContain("traffic-experiment-reason");
  expect(SAME_SEED_NOTE).toContain("compare the recorded outcomes");
  const noMatch = render(<TrafficExperimentForm id="source" options={{ ...options, matchedStop: { available: false, target: null, defaultEnabled: false, reason: "No exact source duration." } }} close={() => {}} onBusy={() => {}} />);
  expect(noMatch).toContain("No exact source duration."); expect(noMatch).toContain("hold back whole-run deltas");
});

test("the entry is a small action, disabled while the source is running, and traffic experiments are named as such everywhere", () => {
  expect(render(<TrafficExperimentDialog id="source" eligible={false} />)).toContain("disabled");
  expect(render(<TrafficExperimentDialog id="source" eligible />)).toContain("Change traffic and run again");
  expect(RERUN_LABEL["workload-variant"]).toBe("Traffic experiment");
  expect(RERUN_SENTENCE["workload-variant"]).toContain("same captured design and seed");
  expect(runKind({ ...options.source, sourceRunId: "source", sourceRunName: "Original source", rerunMode: "workload-variant" })).toEqual({ label: "Traffic experiment", detail: "of Original source" });
  expect(runKind({ ...options.source, sourceRunId: "source", rerunMode: "exact" }).label).toBe("Exact rerun");
  const html = render(<HistoryContent loading={false} error={null} runs={[{ ...options.source, id: "child", sourceRunId: "source", sourceRunName: "Original source", rerunMode: "workload-variant" }]} retry={() => {}} />);
  expect(html).toContain("Traffic experiment"); expect(html).not.toContain("Exact rerun");
});

test("changed workload settings are named in plain words, including omitted dynamics as the historical default", async () => {
  const { workloadChangeLines } = await import("../src/features/reports/workloadChange");
  const dyn = (arrivalProcess: string, applicationCpuCv: number) => ({ version: 1, arrivalProcess, applicationCpuCv });
  const diff = (field: string, earlier: unknown, later: unknown) => ({ field, earlier, later }) as StartingComparison["workload"][number];
  expect(workloadChangeLines([diff("workloadDynamics", null, dyn("poisson", 0))])).toEqual(["Arrival pattern: Even → Random (Poisson)"]);
  expect(workloadChangeLines([diff("workloadDynamics", null, dyn("even", 0.5))])).toEqual(["Application work variability: Fixed (CV 0) → Moderate (CV 0.5)"]);
  expect(workloadChangeLines([diff("workloadDynamics", dyn("poisson", 0.5), dyn("even", 1))])).toEqual(
    ["Arrival pattern: Random (Poisson) → Even", "Application work variability: Moderate (CV 0.5) → High (CV 1)"]);
  expect(workloadChangeLines([diff("workloadDynamics", dyn("poisson", 0.25), null)])).toEqual(
    ["Arrival pattern: Random (Poisson) → Even", "Application work variability: Custom (CV 0.25) → Fixed (CV 0)"]);
  expect(workloadChangeLines([diff("targetThroughput", 1000, 2000), diff("clientRetry", null, { maxAttempts: 3 })])).toEqual(
    ["Configured target rate: 1000 → 2000", 'Client retries: not set → {"maxAttempts":3}']);
});
