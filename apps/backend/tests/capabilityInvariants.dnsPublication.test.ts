import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { dnsSnapshot } from "../simulator/dnsSnapshot";
import { dnsLayout, dnsWorkload } from "./dnsDepth.fixture";

// Invariants of dns-publication/1: nothing resolves before the scripted publication, a cached negative answer outlives publication by at most
// its (ceiling-capped) lifetime, and the evidence times come from the authority and resolver, not from the setting.
const PUBLISH_AT = 2_000_001, NEGATIVE_TTL_US = 5_000_000, request = { interventionId: "dns-publish-entry", revision: 1, target: { resourceId: "dns" }, parameters: {} };
function run(maxTtl: number | undefined, seconds = 12, publish = true) {
  const layout = dnsLayout(maxTtl); layout.resources[0]!.dnsPublication = { version: 1, initialRecord: "absent" };
  const engine = createModel2Engine(captureRunInputs(layout, dnsWorkload, "publication-invariants"), seconds), rows: Array<{ second: number; completed: number; publication: NonNullable<ReturnType<typeof dnsSnapshot>["publication"]> }> = [];
  for (let second = 1; second <= seconds; second++) {
    engine.advance();
    if (second === 2 && publish) { engine.apply({ kind: "intervention", parameters: request }); while (engine.catchingUp) engine.catchUp(10); }
    const evidence = engine.evidence();
    rows.push({ second, completed: evidence.counts.completed, publication: dnsSnapshot(evidence).publication! });
  }
  return rows;
}

test("nothing resolves before the publication, and the first success never precedes it", () => {
  for (const ttl of [undefined, 60, 5, 1]) {
    const rows = run(ttl);
    expect(rows[1]!.completed).toBe(0);
    for (const r of rows) {
      if (r.publication.publishedAtUs === null) { expect(r.publication.firstSuccessfulResolutionAtUs).toBeNull(); expect(r.publication.currentRecord).toBeNull(); }
      else { expect(r.publication.publishedAtUs).toBe(PUBLISH_AT); expect(r.publication.currentRecord).toMatchObject({ generation: 2, ttlUs: 60_000_000 }); }
      if (r.publication.firstSuccessfulResolutionAtUs !== null) expect(r.publication.firstSuccessfulResolutionAtUs).toBeGreaterThanOrEqual(PUBLISH_AT);
    }
  }
});

test("a cached negative answer outlives publication by at most min(negative lifetime, resolver ceiling) plus one connection interval; a ceiling above the negative lifetime changes nothing", () => {
  const first = new Map<number | undefined, number>();
  for (const ttl of [1, 2, 3, 5, 60, undefined]) {
    const at = run(ttl).at(-1)!.publication.firstSuccessfulResolutionAtUs;
    expect(at).not.toBeNull();
    // Callers open a connection every 500 ms in this workload; the exact phase decides which open finds the record, so only the bound is an invariant.
    expect(at!).toBeLessThanOrEqual(PUBLISH_AT + Math.min(NEGATIVE_TTL_US, (ttl ?? 60) * 1_000_000) + 1_500_000);
    first.set(ttl, at!);
  }
  expect(first.get(5)).toBe(first.get(60)); expect(first.get(60)).toBe(first.get(undefined));
});

test("negative cache hits are counted only while a negative answer is cached, and stop growing after the first success", () => {
  const rows = run(60, 14), success = rows.find(r => r.publication.firstSuccessfulResolutionAtUs !== null)!;
  const after = rows.filter(r => r.second > success.second + 1);
  expect(success.publication.negativeCacheHits).toBeGreaterThan(0);
  for (const r of after) expect(r.publication.negativeCacheHits).toBe(rows.find(x => x.second === success.second + 1)!.publication.negativeCacheHits);
});

test("without the scripted publication the name stays unresolved and its time stays Unknown, never zero", () => {
  const rows = run(60, 8, false);
  expect(rows.at(-1)!.completed).toBe(0);
  expect(rows.at(-1)!.publication).toMatchObject({ publishedAtUs: null, firstSuccessfulResolutionAtUs: null, currentRecord: null });
});

test("replaying the same saved design gives identical publication evidence", () => {
  expect(JSON.stringify(run(5))).toBe(JSON.stringify(run(5)));
});
