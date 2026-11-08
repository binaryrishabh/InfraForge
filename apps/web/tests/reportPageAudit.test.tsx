import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportContent } from "../src/features/reports/components/ReportContent";

type Case = {id: string; report: RunReport};
let cases: Case[], missing: Case[], noReadings: Case[], invalid: RunReport, checkpointOnly: RunReport, budgetOnly: RunReport;
const render = (report: RunReport) => renderToStaticMarkup(<MemoryRouter><ReportContent loading={false} error={null} data={report} retry={() => {}} /></MemoryRouter>);
const text = (html: string) => html.replace(/<[^>]*>/g, "");
const headings = (html: string) => [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(m => ({level: Number(m[1]), title: text(m[2]!)}));
const labels = (html: string) => [...html.matchAll(/<section\b[^>]*aria-label="([^"]*)"/g)].map(m => m[1]!);
const reportFor = (id: string, source = cases) => source.find(c => c.id === id)!.report;

beforeAll(async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/reportPageAudit.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, errors).toBe(0);
  ({cases, missing, noReadings, invalid, checkpointOnly, budgetOnly} = JSON.parse(output));
}, 120000);

test("audit representative real saved-report pages and their full evidence record", () => {
  expect(cases.map(c => c.id)).toEqual(["plain", "cached", "queue", "balancer", "cdn", "monitoring", "dns", "memory", "replication", "function", "scheduler", "event-bus", "gateway", "security"]);
  for (const {id, report} of cases) {
    const html = render(report), hs = headings(html);
    expect(report.terminal?.simulatedSeconds).toBe(4);
    expect(report.terminal!.traffic!.offeredRps).toBeGreaterThanOrEqual(0);
    expect(hs.filter(h => h.level === 1)).toEqual([{level: 1, title: `Page audit: ${id}`}]);
    for (let i = 1; i < hs.length; i++) expect(hs[i]!.level - hs[i - 1]!.level).toBeLessThanOrEqual(1);
    expect(html).toContain("Full evidence record");
    const top = hs.filter(h => h.level === 2).map(h => h.title.replace(/^\d+/, ""));
    expect(top).toEqual(["What ran", "Observed — recorded facts", ...(report.interpreted.length ? ["Interpreted — what the evidence supports"] : []),
      "Exact terminal simulation snapshot", ...(report.stages.some(s => s.monthlyEstimateUsd !== undefined) ? ["Recorded cost estimates"] : []), "Deployment stages", "Lineage", "Unknown — evidence limits", "What to inspect next"]);
    console.info(JSON.stringify({design: id, sections: labels(html), headings: hs,
      evidence: report.terminal!.resources.map(r => ({id: r.id, blocks: Object.keys(r).filter(k => typeof r[k as keyof typeof r] === "object")})),
      dnsOwners: report.terminal!.dnsEvidence?.resolvers.map(r => r.id), durationOwners: report.terminal!.durationEvidence?.resources.map(r => r.id)}));
  }
});

test("each representative page keeps only its expected resource sections in reading order", () => {
  const expected: Record<string, string[]> = {
    plain: ["Resource measurements for db", "Database measurements for db"],
    cached: ["Resource measurements for db", "Database measurements for db", "Cache and helper measurements for app", "Cache and helper measurements for cache"],
    queue: ["Queue measurements for queue"], balancer: ["Resource measurements for lb"], cdn: ["CDN measurements for cdn"],
    monitoring: ["Resource measurements for db", "Database measurements for db"],
    dns: ["DNS resolver measurements", "DNS resolver measurements for dns/resolver"],
    memory: ["Resource measurements for lb", "Resource measurements for db", "Database measurements for db", "Memory measurements for app", "Modeled resident memory for app"],
    replication: ["Resource measurements for lb", "Resource measurements for db", "Database measurements for db", "Database replication measurements for db"],
    function: ["Resource measurements for fn", "Function measurements for fn", "Resource measurements for db", "Database measurements for db"],
    scheduler: ["Resource measurements for timer", "Scheduler measurements for timer", "Resource measurements for fn", "Function measurements for fn", "Resource measurements for db", "Database measurements for db"],
    "event-bus": ["Resource measurements for bus", "Event bus measurements for bus", ...["app", "bus", "queue", "queue2", "worker", "worker2", "store"].map(id => `Security measurements for ${id}`), "Queue measurements for queue", "Queue measurements for queue2"],
    gateway: ["Resource measurements for gateway", "Gateway measurements for gateway"],
    security: ["Resource measurements for lb", "Resource measurements for db", "Database measurements for db", ...["lb", "app", "db", "fw"].map(id => `Security measurements for ${id}`)],
  };
  for (const {id, report} of cases) {
    const names = labels(render(report)).filter(l => !l.startsWith("Duration measurements for"));
    expect(names).toEqual(["Recorded run", "Measured caller traffic", ...expected[id]!, "Owned duration measurements", ...(id === "monitoring" ? ["Monitoring measurements for monitor"] : [])]);
    for (const r of report.terminal!.durationEvidence!.resources) expect(labels(render(report))).toContain(`Duration measurements for ${r.id}`);
  }
});

test("plain and worker paths do not acquire irrelevant cache/helper sections", () => {
  for (const id of ["plain", "queue", "balancer", "monitoring", "dns"]) expect(labels(render(reportFor(id))).filter(l => l.startsWith("Cache and helper"))).toEqual([]);
  const html = render(reportFor("cached"));
  expect(html).not.toContain("Application helpers: Unknown");
    expect(html).toContain("Helper ");
  expect(html).toContain("Cache: Hits");
});

test("known empty DNS captures show no phantom Unknown resolver", () => {
  for (const {report} of cases) if (report.terminal!.dnsEvidence?.resolvers.length === 0) expect(labels(render(report))).not.toContain("DNS resolver measurements");
});

test("known empty duration owner lists do not invent an Unknown compute owner", () => {
  const report = reportFor("cdn");
  expect(report.terminal!.durationEvidence!.resources).toEqual([]);
  expect(headings(render(report)).map(h => h.title)).not.toContain("Duration owner: Unknown");
});

test("each resource-specific reading names its owner, including shared live readers", () => {
  for (const {report} of cases) {
    const names = labels(render(report));
    for (const r of report.terminal!.resources) {
      for (const [field, label] of [["database", "Database"], ["databaseReplication", "Database replication"], ["serverless", "Function"],
        ["scheduler", "Scheduler"], ["eventBus", "Event bus"], ["gateway", "Gateway"]] as const) {
        if (r[field]) expect(names).toContain(`${label} measurements for ${r.id}`);
      }
      if (r.lbAccounting) expect(names).toContain(`Resource measurements for ${r.id}`);
    }
  }
});

test("database and nested memory sections expose owner names and a nested heading level", () => {
  const html = render(reportFor("plain"));
  expect(labels(html)).toContain("Database measurements for db");
  expect(labels(render(reportFor("replication")))).toContain("Database replication measurements for db");
  const memory = render(reportFor("memory"));
  expect(labels(memory)).toContain("Modeled resident memory for app");
  expect(headings(memory)).toContainEqual({level: 4, title: "Modeled resident memory (from your numbers)"});
});

test("retained price line items are visible on freeform saved reports", () => {
  for (const {report} of cases) {
    expect(report.monthlyBudgets).toBeUndefined();
    const stage = report.stages.find(s => s.name === "CostEstimate")!;
    if (stage.monthlyEstimateUsd !== undefined) {
      expect(stage.lineItems!.length).toBe(report.run.resourceCount);
      expect(headings(render(report)).map(h => h.title)).toContain("Monthly resource price line items");
    } else {
      expect(stage.lineItems).toBeUndefined();
      expect(headings(render(report)).map(h => h.title)).not.toContain("Monthly resource price line items");
    }
  }
});

test("missing relevant evidence stays visible as Unknown under its recorded resource", () => {
  for (const [id, label, reading] of [
    ["plain", "Database measurements for db", "Serving queries"],
    ["cached", "Cache and helper measurements for cache", "Cache: Hits"],
    ["cached", "Cache and helper measurements for app", "Application helper: Received"],
    ["queue", "Queue measurements for queue", "Acknowledged messages"],
    ["cdn", "CDN measurements for cdn", "CDN: Hits"],
    ["monitoring", "Monitoring measurements for monitor", "Monitoring: Generated samples"],
  ]) {
    const html = render(reportFor(id!, missing));
    expect(labels(html)).toContain(label!);
    expect(html).toContain(`<dt>${reading}</dt><dd>Unknown</dd>`);
  }
  for (const [id, label] of [["plain", "Database measurements for db"], ["queue", "Queue measurements for queue"], ["cdn", "CDN measurements for cdn"], ["monitoring", "Monitoring measurements for monitor"]]) {
    const html = render(reportFor(id!, noReadings));
    expect(labels(html)).toContain(label!);
    expect(html).not.toContain("Recorded resource measurements;");
  }
});

test("invalid captures, diagnostic captures and budget-only history keep their evidence limits", () => {
  expect(invalid.terminal).toBeNull();
  expect(labels(render(invalid))).not.toContain("Cache and helper measurements for cache");
  expect(headings(render(invalid)).some(h => h.title.endsWith("Exact terminal simulation snapshot"))).toBe(false);
  expect(checkpointOnly.terminal).toBeNull();
  expect(headings(render(checkpointOnly)).some(h => h.title.endsWith("Latest retained simulation checkpoint"))).toBe(true);
  expect(budgetOnly.monthlyBudgets!.length).toBeGreaterThan(0);
  const numbered = headings(render(budgetOnly)).filter(h => h.level === 2 && /^\d+/.test(h.title)).map(h => Number(h.title.match(/^\d+/)![0]));
  expect(numbered).toEqual(numbered.map((_, i) => i + 1));
});
