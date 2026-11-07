import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";

const render = (report: RunReport) => renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
const definitions = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([,m]) => m.path.startsWith("objectStorage."));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("saved real engine reports render object populations and bounded identities; absent/older evidence remains Unknown", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/objectLedgerReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, diagnostics] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, diagnostics).toBe(0);
  const data = JSON.parse(output) as {reports: RunReport[]; old: RunReport; partial: RunReport; noRows: RunReport; checkpointOnly: RunReport};
  for (const report of data.reports) {
    const html = render(report), m = report.terminal!.resources.find(r => r.id === "store")!.objectStorage!;
    expect(html).toContain('aria-label="Object storage measurements for store"');
    expect(html).toContain("not the final second");
    expect(html).toContain("they are not additional put attempts");
    expect(html).toContain("Omitted identities and earlier generations are Unknown");
    const summaries = lessonRunMeasurements(report, definitions.map(([label]) => label));
    for (const [label, definition] of definitions.filter(([,d]) => !d.path.includes("*"))) {
      const key = definition.path.split(".")[1]!, v = (m as unknown as Record<string, number | boolean | null | undefined>)[key];
      const text = v == null ? "Unknown" : typeof v === "boolean" ? v ? "Yes" : "No" : v.toLocaleString();
      expect(html).toMatch(new RegExp(`${escape(label)}</dt><dd[^>]*>${escape(text)}<`));
      expect(summaries.find(s => s.label === label)!.value).toBe(`store: ${v == null ? "Unknown" : `${typeof v === "boolean" ? v ? "Yes" : "No" : v}${"unit" in definition ? ` ${definition.unit}` : ""}`}`);
    }
    for (const [reason, count] of Object.entries(m.commandReasons!)) expect(html).toContain(`<dt>${reason}</dt><dd class="if-num">${count.toLocaleString()}</dd>`);
    for (const o of m.objects!) {
      const e = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;");
      expect(html).toContain(`<th scope="row" class="pr-4 text-left font-normal">${e(o.namespace)}</th><td class="break-all pr-4">${e(o.key)}</td><td class="if-num pr-4">${o.generation.toLocaleString()}</td><td class="if-num">${o.bytes.toLocaleString()}</td>`);
      expect(summaries.find(s => s.label === "Object generation (current)")!.value).toContain(`store / ${JSON.stringify([o.namespace, o.key])}: ${o.generation}`);
    }
  }
  for (const old of [data.old, data.noRows]) {
    const html = render(old);
    for (const [label] of definitions.filter(([,d]) => !d.path.includes("*"))) expect(html).toMatch(new RegExp(`${escape(label)}</dt><dd[^>]*>Unknown<`));
    expect(html).toContain("Object inventory (current)</h4><p>Unknown</p>");
    expect(html).toContain("Object command reasons (cumulative)</h4><p>Unknown</p>");
    expect(lessonRunMeasurements(old, definitions.map(([label]) => label)).every(s => s.value === "store: Unknown")).toBe(true);
  }
  expect(render(data.partial)).toContain("Object committed puts (cumulative)</dt><dd class=\"if-num\">3</dd>");
  expect(render(data.partial)).toContain("Object generation high-water mark</dt><dd class=\"if-num\">Unknown</dd>");
  expect(render(data.partial)).toContain("Puts reaching capacity check (cumulative)</dt><dd class=\"if-num\">Unknown</dd>");
  expect(render(data.checkpointOnly)).toContain("Latest retained simulation checkpoint");
  expect(lessonRunMeasurements(data.checkpointOnly, definitions.map(([label]) => label)).every(s => s.value === "store: Unknown")).toBe(true);
}, 60000);
