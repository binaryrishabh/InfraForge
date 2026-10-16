import { expect, test } from "bun:test";
import { connectedFixture } from "./connectedFixture";
import { compileEnvelope, captureCuts, readEnvelope } from "../internalModel2/envelope";
import { instantiate, capture, readCapture } from "../internalModel2/capture";
import { causalJournal, readCausal } from "../internalModel2/causalJournal";
import { contentHash } from "../internalModel2/identity";
function retained(raw = 32) {
  const f = connectedFixture(); (f.request.contract as any).limits.maxRawResults = raw;
  const input = compileEnvelope("run", "owner", f.layout, new Date(f.request.expectedDesignUpdatedAt), f.request), runtime = instantiate(input);
  let e: ReturnType<typeof capture> | undefined;
  for (const at of captureCuts(input)) { runtime.advanceTo(at); e = capture(runtime, input, (e?.sequence ?? 0) + 1, e?.checkpoints); }
  if (e?.schema !== "infraforge-internal-evidence/2") throw Error("Expected v2");
  return { input, evidence: e };
}
const rehash = <T extends { fingerprint: string }>(value: T) => { const { fingerprint: _old, ...body } = value; value.fingerprint = contentHash(body); return value; };
test("no retained caller rows cannot claim exact causality even with a complete causal journal", () => {
  const { input, evidence } = retained(0);
  expect(evidence.model.causal.complete).toBe(true); expect(evidence.model.callers.results).toHaveLength(0);
  expect(evidence.completeness.callerOmitted).toBe(12); expect(evidence.completeness.exactCausality).toBe(false);
  expect(readCapture(evidence, input.fingerprint)).toEqual(evidence);
});
test("v2 rejects valid-hash projection, timing and completeness corruption", () => {
  const { input, evidence } = retained();
  const mutations = [
    (e: typeof evidence) => { e.model.database[0]!.transactions.committed++; },
    (e: typeof evidence) => { e.model.callers.retention.omitted++; },
    (e: typeof evidence) => { e.checkpoints[1]!.atUs = e.checkpoints[0]!.atUs; },
    (e: typeof evidence) => { e.model.capture.throughUs--; },
    (e: typeof evidence) => { e.completeness.exactCausality = false; },
    (e: typeof evidence) => { e.model.resources.pop(); },
  ];
  for (const change of mutations) { const changed = structuredClone(evidence); change(changed); expect(() => readCapture(rehash(changed), input.fingerprint)).toThrow(); }
  const relabeled = rehash({ ...input, schema: "infraforge-internal-execution/1" });
  expect(() => readEnvelope(relabeled, relabeled.fingerprint)).toThrow();
});
for (const limit of ["events", "identities", "textCharacters"] as const) test(`${limit} overflow is bounded, marked and snapshot-isolated`, () => {
  const journal = causalJournal({ events: 512, identities: 128, textCharacters: 65536, [limit]: 1 });
  const event = (n: number) => ({ atUs: n, kind: "caller-offered", resource: "caller", work: { rootId: `root${n}`, callId: `call${n}`, attempt: 1, operation: "read", offeredAt: n }, detail: {} });
  journal.observe(event(0)); const prefix = journal.capture(); journal.observe(event(1));
  const e = journal.capture(); expect(e.complete).toBe(false); expect(e.omitted).toBeGreaterThan(0); expect(e.rows.length).toBeLessThanOrEqual(1);
  expect(readCausal(e)).toEqual(e); expect(prefix.offered).toBe(1); expect(e.offered).toBe(2);
  prefix.strings.push("outside"); expect(journal.capture().strings).not.toContain("outside");
});
test("causal reader refuses impossible references, duplicate identities and omission watermarks", () => {
  const { evidence } = retained(), original = evidence.model.causal;
  const bad = structuredClone(original); bad.identities.push(bad.identities[0]!); expect(() => readCausal(bad)).toThrow();
  const missing = structuredClone(original); missing.rows[0]![3] = 999; expect(() => readCausal(missing)).toThrow();
  const watermark = structuredClone(original); watermark.complete = false; watermark.omitted = 1; watermark.offered++; watermark.firstOmittedAt = 0; expect(() => readCausal(watermark)).toThrow();
});
test("read and write labels cannot hide opposite database plans", () => {
  for (const operation of ["read", "write"]) {
    const f = connectedFixture(), plans = (f.request.contract as any).nodes.db.resources[0].config.plans;
    plans[operation].statements[0].kind = operation === "read" ? "write" : "snapshot-read";
    expect(() => compileEnvelope("run", "owner", f.layout, new Date(), f.request)).toThrow();
  }
});
