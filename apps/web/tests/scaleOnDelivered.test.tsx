import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";

const render = (report: RunReport) => renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
const reading = (html: string, label: string, v: string) => expect(html).toContain(`<dt>${label}</dt><dd class="if-num break-all">${v}</dd>`);

test("real lab reports render the selected scaling signal, hold counts and in-service pool through the existing startup readings", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/scaleOnDelivered.fixture.ts")], { stdout: "pipe", stderr: "pipe" });
  const [output, diagnostics] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, diagnostics).toBe(0);
  const { starter, reference } = JSON.parse(output) as { starter: RunReport; reference: RunReport };
  for (const [report, desired, inService, missing] of [[starter, "1", "1", "9"], [reference, "2", "2", "0"]] as const) {
    const html = render(report);
    reading(html, "Scaling signal source", "observed-core-time");
    reading(html, "Scaling signal monitoring backend", "monitor/backend");
    reading(html, "Scaling signal freshness bound (us)", "8,000,000");
    reading(html, "Desired replicas (current)", desired);
    reading(html, "LB-eligible replicas (current)", inService);
    reading(html, "Controller evaluations (cumulative)", "9");
    reading(html, "Controller missing measurements (cumulative)", missing);
  }
  // A saved report without the signal evidence (an unmarked pool or older record) shows no invented source rows.
  const old = structuredClone(reference);
  for (const m of old.terminal!.resources) for (const c of m.startup?.controllers ?? []) delete c.signal;
  expect(render(old)).not.toContain("Scaling signal source");
  expect(starter.challenge!.criteria.find(c => c.id === "scaled")?.status).toBe("not-met");
  expect(reference.challenge!.criteria.find(c => c.id === "scaled")?.status).toBe("met");
}, 60000); // spawns a fixture process; the default 5 s fails under parallel suite load
