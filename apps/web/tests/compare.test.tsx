import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunComparison, RunSummary } from "@infraforge/contracts/reports";
import { CompareContent } from "../src/features/reports/components/CompareView";
import { CompareSelection, RunSelection } from "../src/features/reports/components/RunSelection";
import { selectionReason, toggleRun } from "../src/features/reports/selection";
import { signedValue } from "../src/features/reports/formatDifference";
import { ComparePicker } from "../src/features/reports/components/ComparePicker";

const run: RunSummary = { id: "a", infrastructureId: null, infrastructureName: "Archived design", status: "torn-down",
  createdAt: "2026-10-13T10:00:00.000Z", updatedAt: "2026-10-13T10:10:00.000Z", resourceCount: 1,
  workload: null, workloadSource: "unavailable", chaosEventCount: 0, topologyRevision: 0, hasReportData: true };
const comparison: RunComparison = { version: 1, runs: [run, { ...run, id: "b" }], available: true, unavailableReason: null,
  lineage: "unrelated", headline: "descriptive-only", starting: { grade: "side-by-side-only", facets: { inputVersion: "unknown", model: "unknown", catalog: "unknown", workload: "unknown", seed: "unknown", topology: "unknown", resourceOrder: "unknown" }, design: null, workload: [], alignment: { code: "unknown", aligned: [], shifted: [], scope: "Shared starting resources only." } },
  conduct: { code: "unknown", actions: [[], []], speedNote: "Simulation speed can change when later human actions land.", reasons: [] },
  evidence: { code: "missing", states: [null, null], matchedDuration: null, deterministicState: "not-established" },
  outcomes: [], resources: [], costs: [{ field: "Accumulated simulated cost", unit: "USD", earlier: 0.01, later: 0.02, delta: null, withheldReason: "Matching exact durations required." }], gates: [[], []],
  observed: [{ id: "recorded", message: "Only recorded facts.", sources: ["runInputs"] }], interpreted: [], unknown: [{ id: "legacy", message: "Legacy provenance unknown.", sources: ["runInputs"] }] };
const render = (v: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{v}</MemoryRouter>);
test("compare loading/errors/legacy evidence do not invent final-state deltas", () => {
  expect(render(<CompareContent loading error={null} data={null} retry={() => {}} />)).toContain('role="status"');
  const error = render(<CompareContent loading={false} error="Session ended" data={null} retry={() => {}} />);
  expect(error).toContain('role="alert"'); expect(error).toContain("Try again");
  const html = render(<CompareContent loading={false} error={null} data={comparison} retry={() => {}} />);
  expect(html).toContain("Side-by-side only"); expect(html).toContain("Legacy provenance unknown");
  expect(html).toContain("withheld"); expect(html).toContain("not a cloud bill");
  expect(html).toContain("later minus earlier"); expect(html).toContain('<th scope="col"'); expect(html).toContain('<th scope="row"');
  expect(html).toContain('sm:hidden'); expect(html).toContain('hidden sm:table'); expect(html).not.toContain("overflow-x");
  expect(html).toContain('href="/reports/a"'); expect(html).toContain('href="/reports/b"');
  expect(html).toContain("No usable final evidence"); expect(html).not.toContain("winner");
});
test("two-run selection is keyboard-native, bounded and gives live/pending reasons", () => {
  let ids: string[] = []; ids = toggleRun(ids, "a"); expect(ids).toEqual(["a"]);
  expect(render(<CompareSelection selected={ids} />)).toContain("Select a second run");
  ids = toggleRun(ids, "b"); expect(toggleRun(ids, "c")).toEqual(ids);
  expect(toggleRun(ids, "a")).toEqual(["b"]);
  const full = render(<RunSelection run={{ ...run, id: "c" }} selected={ids} onToggle={() => {}} />);
  expect(full).toContain('type="checkbox"'); expect(full).toContain("disabled"); expect(full).toContain("Clear one selected run");
  for (const status of ["pending", "running", "live"]) expect(selectionReason({ ...run, status })).toContain("wait for gates");
  const count = render(<CompareSelection selected={ids} />);
  expect(count).toContain('aria-live="polite"'); expect(count).toContain("Compare selected runs");
  expect(render(<ComparePicker id="a" eligible />)).toContain("Compare with…");
});
test("signed differences convey units without value judgements", () => {
  expect(signedValue(2)).toBe("+2"); expect(signedValue(-2)).toBe("-2"); expect(signedValue(0)).toBe("0"); expect(signedValue(null)).toBe("withheld");
});
