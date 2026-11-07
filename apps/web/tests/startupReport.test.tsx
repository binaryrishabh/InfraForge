import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";

const render = (report: RunReport) => renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
const definitions = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([,m]) => m.path.startsWith("startup."));
const e = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;");
const v = (x: string | number | boolean | null | undefined) => x == null ? "Unknown" : typeof x === "boolean" ? x ? "Yes" : "No" : typeof x === "number" ? x.toLocaleString() : e(x);

test("real engine reports render owned startup values and identities, with Unknown for old, partial and missing records", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/startupReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, diagnostics] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, diagnostics).toBe(0);
  const data = JSON.parse(output) as {reports: RunReport[]; old: RunReport; partial: RunReport; noRows: RunReport; checkpointOnly: RunReport};
  for (const report of data.reports) {
    const html = render(report), m = report.terminal!.resources.find(r => r.id === "app")!.startup!;
    expect(html).toContain('aria-label="Startup measurements for app"');
    expect(html).toContain("Listener-ready opens the process gate after startup");
    expect(html).toContain("replica generation and exact first LB-eligible time are Unknown");
    const reading = (label: string, x: string | number | boolean | null | undefined) => expect(html).toContain(`<dt>${e(label)}</dt><dd class="if-num break-all">${v(x)}</dd>`);
    reading("Startup sample time (us)", m.sampledAtUs);
    for (const c of m.clients!) {
      expect(html).toContain(e(c.id));
      reading("Artifact pulled bytes (cumulative)", c.pulledBytes); reading("Artifact reused layers (cumulative)", c.reusedLayers); reading("Artifact failures (cumulative)", c.failures);
      for (const r of c.replicas!) {
        reading("Image reference", r.reference); reading("Resolved image digest", r.resolvedDigest); reading("Artifact-ready time (us)", r.artifactReadyAtUs);
        for (const layer of r.requiredLayers!) {reading("Required image layer digest", layer.digest); reading("Required image layer bytes", layer.bytes);}
      }
      for (const event of c.events!) expect(html).toContain(`${v(event.at)} us / ${e(event.id)} / ${e(event.kind)}: ${e(event.detail)}`);
    }
    for (const r of m.registries!) {
      reading("Registry response body bytes (cumulative)", r.generatedResponseBodyBytes);
      for (const blob of r.blobs!) {reading("Registry blob digest", blob.digest); reading("Registry blob bytes", blob.bytes);}
      for (const manifest of r.manifests!) expect(html).toContain(e(manifest.digest));
      for (const tag of r.tags!) expect(html).toContain(`${e(tag.tag)}: ${e(tag.digest)}`);
    }
    for (const c of m.controllers!) {
      reading("Desired replicas (current)", c.desired); reading("LB-eligible replicas (current)", c.inService);
      for (const r of c.replicas!) {reading("Listener-ready time (us)", r.listenerReadyAtUs); reading("Replica LB healthy (current)", r.lbHealthy);}
    }
    const summaries = lessonRunMeasurements(report, definitions.map(([label]) => label));
    expect(summaries.find(s => s.label === "Artifact-ready time (us)")!.value).toContain("app / app#0/image / app#0: Unknown");
    const ready = m.clients!.find(c => c.id === "app#1/image")?.replicas?.[0];
    if (ready?.artifactReadyAtUs != null) expect(summaries.find(s => s.label === "Artifact-ready time (us)")!.value).toContain(`app / app#1/image / app#1: ${ready.artifactReadyAtUs} us`);
    if (ready?.requiredLayers?.length) expect(summaries.find(s => s.label === "Required image layer bytes")!.value).toContain(`app / app#1/image / app#1 / ${ready.requiredLayers[0]!.digest}: ${ready.requiredLayers[0]!.bytes}`);
  }
  for (const old of [data.old, data.noRows]) {
    const html = render(old);
    expect(html).toContain("Startup sample time (us)</dt><dd class=\"if-num break-all\">Unknown</dd>");
    expect(html).toContain("Artifact clients</h4><p>Unknown</p>");
    expect(html).toContain("Startup controllers</h4><p>Unknown</p>");
    expect(lessonRunMeasurements(old, definitions.map(([label]) => label)).every(s => !s.value.includes(": 0"))).toBe(true);
    expect(lessonRunMeasurements(old, ["Artifact-ready time (us)"])[0]!.value).toContain("app: Unknown");
  }
  expect(render(data.partial)).toContain("Artifact pulled bytes (cumulative)</dt><dd class=\"if-num break-all\">1,024</dd>");
  expect(render(data.partial)).toContain("Artifact failures (cumulative)</dt><dd class=\"if-num break-all\">Unknown</dd>");
  expect(render(data.partial)).toContain("Artifact replica records: Unknown");
  expect(render(data.checkpointOnly)).toContain("Latest retained simulation checkpoint");
  expect(lessonRunMeasurements(data.checkpointOnly, definitions.map(([label]) => label)).every(s => !s.value.includes(": 0"))).toBe(true);
}, 60000);
