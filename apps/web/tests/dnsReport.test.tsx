import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";

const read = (input: unknown, keys: string[]): unknown[] => {
  if (!keys.length) return [input];
  if (!input || typeof input !== "object") return [undefined];
  const [key, ...rest] = keys;
  return key === "*" ? Object.values(input).length ? Object.values(input).flatMap(v => read(v, rest)) : [undefined]
    : read((input as Record<string, unknown>)[key!], rest);
};
test("real DNS reports render audited values, resolver/name identity, windows, units and historical Unknowns", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/dnsReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, errors).toBe(0);
  const f = JSON.parse(output) as {cases: Array<{report: RunReport}>; internalReports: RunReport[]; missing: RunReport; nullCounter: RunReport; checkpointOnly: RunReport};
  const labels = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([label]) => label.startsWith("DNS:"));
  const render = (r: RunReport) => renderToStaticMarkup(<ReportMeasurements report={r} number={3} />);
  for (const r of [...f.cases.map(c => c.report), ...f.internalReports]) {
    const html = render(r), e = (r.terminal ?? r.checkpoint)!.dnsEvidence!;
    expect(html).toContain("absolute simulated microseconds (us)"); expect(html).toContain("cumulative from run start");
    expect(html).toContain("DNS success does not establish application reachability");
    expect(html).toContain("not a timestamped transition history");
    for (const [label, d] of labels) {
      const source = readFileSync(resolve(import.meta.dir, "../../..", d.source), "utf8");
      expect(source).toContain(d.marker);
      // A recorded empty cache is an empty population, not a missing cached answer.
      if (d.path.includes(".cache.*") && e.resolvers.every(r => r.cache.length === 0 && r.cacheOmitted === 0)) {
        expect(html).not.toContain(`<dt>${label}</dt>`);
        continue;
      }
      for (const v of read(e, d.path.split(".").slice(1))) {
        const value = v == null ? "Unknown" : String(v);
        expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
        if (r.terminal) expect(lessonRunMeasurements(r, [label])[0]!.value).toContain(typeof v === "boolean" ? (v ? "Yes" : "No") : value); // Lesson summaries show booleans as Yes/No.
      }
    }
    for (const resolver of e.resolvers) {
      expect(html).toContain(resolver.id);
      for (const c of resolver.cache) {
        expect(html).toContain(c.name); expect(html).toContain(c.answer.authority);
        if (r.terminal) expect(lessonRunMeasurements(r, ["DNS: Cached answer generation"])[0]!.value).toContain(`${resolver.id} / ${c.name}: ${c.answer.generation}`);
      }
    }
  }
  for (const [label] of labels) {
    expect(render(f.missing)).toContain(`<dt>${label}</dt><dd>Unknown</dd>`);
    expect(lessonRunMeasurements(f.missing, [label])[0]!.value).toBe("Unknown");
    expect(lessonRunMeasurements(f.checkpointOnly, [label])[0]!.value).toBe("Unknown");
  }
  expect(render(f.nullCounter)).toContain("<dt>DNS: Cache hits</dt><dd>Unknown</dd>");
  expect(render(f.checkpointOnly)).toContain("Latest retained simulation checkpoint");
}, 180000);
