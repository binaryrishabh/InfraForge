import { expect, test } from "bun:test";
import { DnsEvidenceSchema } from "../reports/dnsSchema";
import { dnsSnapshot } from "../simulator/dnsSnapshot";
import { dnsReportFixture } from "./dnsReport.fixture";
import { checkLessonClaims } from "../learning/claims";
import { findLearningLesson } from "../learning/registry";
import { definition } from "./challengeHarness";
import { INTERVENTIONS, interventionError } from "@infraforge/domain/resource";
import { scenarioError } from "@infraforge/simulation/model2-run";

const f = dnsReportFixture();
test("real engine DNS values round trip through terminal/checkpoint capture, JSON and reports", () => {
  for (const c of f.cases) {
    expect(c.report.terminal!.dnsEvidence).toEqual(c.captured);
    expect(c.report.checkpoint!.dnsEvidence).toEqual(c.captured);
    const raw = c.raw.systems.resolvers[0]!, saved = c.captured.resolvers[0]!;
    for (const key of ["id", "queries", "hits", "misses", "authoritativeLookups", "failures", "fills", "expirations", "evictions", "replaced"] as const) expect(saved[key]).toBe(raw[key]);
    expect(saved.queries).toBeGreaterThan(0); expect(saved.misses).toBeGreaterThan(0);
    expect(c.captured).toMatchObject({fromUs: 0, throughUs: c.raw.capture.throughUs, timestampComplete: c.raw.capture.timestampComplete ?? null});
    saved.cache.forEach((e, i) => {
      expect(e.name).toBe(raw.cache[i]!.name); expect(e.expiresAt).toBe(raw.cache[i]!.expiresAt);
      expect(e.answer).toMatchObject(raw.cache[i]!.answer); expect(e.answer.generation).toBe(1);
    });
  }
  // Controlled runs change only the existing TTL ceiling; no new record-change lab is implied.
  expect(f.cases[1]!.captured.resolvers[0]!.expirations).toBeGreaterThan(f.cases[0]!.captured.resolvers[0]!.expirations!);
  // The product connection is reused; expiry alone does not force another DNS query.
  expect(f.cases[1]!.captured.resolvers[0]!.authoritativeLookups).toBe(f.cases[0]!.captured.resolvers[0]!.authoritativeLookups);
  console.info(JSON.stringify(f.cases.map(c => ({ttl: c.ttl, evidence: c.captured}))));
});

test("internal engine expiry and generation changes retain positive and negative answer identity without inventing history", () => {
  f.internalReports.forEach((r, i) => expect(r.checkpoint!.dnsEvidence).toEqual(f.internalEvidence[i]));
  for (let i = 0; i < f.internalRaw.length; i++) {
    const raw = f.internalRaw[i]!.systems.resolvers[0]!, saved = f.internalEvidence[i]!.resolvers[0]!;
    expect(saved.cache).toEqual(raw.cache.map(c => ({...c, answer: {...c.answer, reason: c.answer.reason ?? null,
      generation: c.answer.generation ?? null, expiresAt: c.answer.expiresAt ?? null,
      addresses: c.answer.addresses ?? null, addressesOmitted: c.answer.addresses ? 0 : null}})));
  }
  const old = f.internalEvidence[1]!.resolvers[0]!, fresh = f.internalEvidence[3]!.resolvers[0]!;
  expect(old.cache.find(c => c.name === "app.example")!.answer.generation).toBe(1);
  expect(old.cache.find(c => c.name === "new.example")!.answer).toMatchObject({ok: false, reason: "nxdomain", generation: null, addresses: null});
  expect(f.internalEvidence[2]!.resolvers[0]!.cache).toEqual([]);
  expect(fresh.cache.find(c => c.name === "app.example")!.answer.generation).toBe(2);
  expect(fresh.cache.find(c => c.name === "new.example")!.answer.ok).toBe(true);
  expect(fresh.expirations).toBe(2); expect(old.hits).toBe(3);
});

test("absent DNS evidence stays absent, null remains Unknown, malformed counters and duplicate identities refuse", () => {
  expect(f.missing.terminal!.dnsEvidence).toBeUndefined();
  expect(f.nullCounter.terminal!.dnsEvidence!.resolvers[0]!.hits).toBeNull();
  expect(f.invalid.terminal).toBeNull(); expect(f.duplicate.terminal).toBeNull();
  const base = f.cases[0]!.captured;
  for (const value of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = structuredClone(base); bad.resolvers[0]!.fills = value;
    expect(DnsEvidenceSchema.safeParse(bad).success).toBe(false);
  }
  const bad = structuredClone(base); bad.resolvers[0]!.cache[0]!.answer.expiresAt!++;
  expect(DnsEvidenceSchema.safeParse(bad).success).toBe(false);
});

test("capture bounds resolvers, cached names and addresses with explicit omitted counts", () => {
  const source = structuredClone(f.cases[0]!.raw), r = source.systems.resolvers[0]!, c = r.cache[0]!;
  c.answer.addresses = Array.from({length: 70}, (_, i) => `address-${i}`);
  r.cache = Array.from({length: 70}, (_, i) => ({...structuredClone(c), name: `name-${i}.example`, answer: {...structuredClone(c.answer), name: `name-${i}.example`}}));
  source.systems.resolvers = Array.from({length: 70}, (_, i) => ({...structuredClone(r), id: `resolver-${i}`}));
  const saved = dnsSnapshot(source);
  expect(saved.resolvers).toHaveLength(64); expect(saved.resolversOmitted).toBe(6);
  expect(saved.resolvers[0]!.cache).toHaveLength(64); expect(saved.resolvers[0]!.cacheOmitted).toBe(6);
  expect(saved.resolvers[0]!.cache[0]!.answer.addresses).toHaveLength(64);
  expect(saved.resolvers[0]!.cache[0]!.answer.addressesOmitted).toBe(6);
  expect(source.systems.resolvers).toHaveLength(70);
});

test("claim gate accepts audited DNS labels, refuses invented transition time and unsupported DNS updates refuse", () => {
  const lesson = structuredClone(findLearningLesson("diagnose-query-admission")!);
  lesson.experiment!.evidenceToInspect = ["DNS: Cache hits; DNS: Cached answer generation; DNS: Cached answer expiry"];
  expect(checkLessonClaims(lesson, definition("diagnose-query-admission"))).toEqual([]);
  lesson.experiment!.evidenceToInspect.push("DNS: Record change recovery time");
  expect(checkLessonClaims(lesson, definition("diagnose-query-admission")).join(" ")).toContain("report does not render measurement DNS: Record change recovery time");
  expect(INTERVENTIONS.filter(d => /dns|record/i.test(d.id)).map(d => d.id)).toEqual(["dns-publish-entry"]);
  const request = {interventionId: "dns-record", revision: 1, target: {resourceId: "dns"}, parameters: {}};
  expect(interventionError(request)).toContain("INTERVENTION_REVISION");
  expect(scenarioError({version: 1, visibility: "revealed", steps: [{id: "update", atSecond: 1, request}]}, 4)).toContain("INTERVENTION_REVISION");
});
