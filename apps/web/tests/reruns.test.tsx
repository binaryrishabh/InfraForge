import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RerunOptions } from "@infraforge/contracts/reports";
import { RerunChoices, RerunDialog } from "../src/features/reports/components/RerunDialog";
import { HistoryContent } from "../src/features/reports/components/RunList";

const options: RerunOptions = { source: { id: "source", infrastructureId: null, infrastructureName: "Source design", status: "torn-down",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resourceCount: 1, workload: null, workloadSource: "captured",
  chaosEventCount: 0, topologyRevision: 0, hasReportData: true },
  workload: { targetThroughput: 500000, throughputUnit: "per-hour", payloadSize: "medium", trafficShape: "steady" }, seed: "captured-seed",
  exact: { available: true, reason: null }, currentDesign: { available: false, reason: "Original design deleted", preview: null, inputHash: null, modelCatalogCompatible: false },
  matchedStop: { available: true, target: 620, defaultEnabled: true, reason: null } };
const render = (v: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{v}</MemoryRouter>);
test("rerun choices are explicit, native and preserve workload, seed and stop context", () => {
  const html = render(<RerunChoices options={options} mode="exact" onMode={() => {}} matched onMatched={() => {}} />);
  expect(html).toContain('type="radio"'); expect(html).toContain('type="checkbox"'); expect(html).toContain("checked");
  expect(html).toContain("same workload, same seed, same simulator/catalog");
  expect(html).toContain("Original run actions are NOT replayed");
  expect(html).toContain("Original design deleted"); expect(html).toContain("captured-seed");
  expect(html).toContain("620 s"); expect(html).toContain("500,000");
});
test("ineligible source cannot start a rerun, and history uses captured lineage names", () => {
  expect(render(<RerunDialog id="source" eligible={false} />)).toContain("disabled");
  const html = render(<HistoryContent loading={false} error={null} runs={[{ ...options.source, id: "child", sourceRunId: "source", sourceRunName: "Original source", rerunMode: "exact" }]} retry={() => {}} />);
  expect(html).toContain("Exact rerun");
  expect(html).toContain("of Original source");
});
