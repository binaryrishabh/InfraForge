import { test, expect } from "bun:test";
import { DEFAULT_RETRY_SETTINGS, type RetrySettings } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { contractFromDesign } from '../src/model2/product/fromDesign';
import { compileProduct } from '../src/model2/product/compiler';
import { createProductModel2 } from '../src/model2/product/run';
import { createHash } from 'node:crypto';
const d = {schema:'infraforge-saved-design/1',resources:[{id:'lb',type:'Load Balancer',x:0,y:0},{id:'app',type:'Virtual Machine',x:0,y:0}],connections:[{id:'e',sourceId:'lb',targetId:'app',sourceType:'Load Balancer',targetType:'Virtual Machine',port:80}],workload:{targetThroughput:60,throughputUnit:'per-minute',trafficShape:'steady',readWriteRatio:0.8,payloadSize:'light'}} as const;
function output(retry?: RetrySettings) {
  const saved = structuredClone(d) as unknown as SavedProductDesign;
  if (retry) saved.resources[0]!.retry = retry;
  const a = contractFromDesign(saved); if ("refused" in a) throw Error(JSON.stringify(a));
  const c = compileProduct(saved, a.contract); if (!c.ok) throw Error(JSON.stringify(c));
  const r = createProductModel2(c.value); r.advanceTo(1000000);
  return { contract: a.contract, compiled: c.value, evidence: r.evidence(), assumptions: a.assumptions };
}
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v).replaceAll("\r\n", "\n")).digest("hex");
test("absent and disabled retry preserve pre-change contract, compiled input, assumptions and evidence bytes", () => {
  const a = output();
  expect(Object.fromEntries(Object.entries(a).map(([k,v]) => [k,hash(v)]))).toEqual({
    contract: "fefb47e551c224cf4fffe759dd6aba44cdeadcf7a5b6f6d57b275ae879425198",
    compiled: "eb334d43ff8353187d3bc23835d1a634efe01832f1df4f6daf01c4f1d18463db",
    evidence: "2e8fbc542b68a4596b5a7a16034600650fe8c30202ac1f626265d1d63b724404",
    assumptions: "d20f1bb8e6bb3442d6a044cf99f61d59ba5b643178760f731a7b3c58a52f3f7f",
  });
  expect(output({ enabled: false })).toEqual(a);
  expect(output({ ...DEFAULT_RETRY_SETTINGS, enabled: false })).toEqual(a);
});
test("canvas retries retain authored quantities and group provenance with exact replay", () => {
  const a = output(DEFAULT_RETRY_SETTINGS);
  expect(a).toEqual(output(DEFAULT_RETRY_SETTINGS));
  expect(a.compiled.semantic.numericOrigins.filter((r) => r.path.includes(".retry."))).toEqual(expect.arrayContaining([
    expect.objectContaining({ origin: "user-authored", sources: ["saved-design:lb.retry.enabled"] }),
    expect.objectContaining({ origin: "user-authored", sources: ["saved-design:lb.retry.retryOn"] }),
  ]));
  expect(a.contract.ledger.filter((r) => r.id.startsWith("lb.retry.")).every((r) => r.classification === "user-input")).toBe(true);
  expect(a.assumptions.some((r) => r.id.includes(".config.retry"))).toBe(false);
});
test("direct callers reject invalid retry intent and ownership", () => {
  for (const patch of [{maxAttempts: 0}, {maxAttempts: 6}, {backoffMs: -1}, {jitterRatio: 1.1}, {maxConcurrentRetries: 0}, {retryOn: []}, {retryOn: ["unknown"]}, {allowAmbiguousNonIdempotent: true}]) {
    const saved = structuredClone(d) as unknown as SavedProductDesign;
    saved.resources[0]!.retry = { ...DEFAULT_RETRY_SETTINGS, ...patch } as RetrySettings;
    expect("refused" in contractFromDesign(saved)).toBe(true);
  }
  const saved = structuredClone(d) as unknown as SavedProductDesign;
  saved.resources[1]!.retry = {enabled: false};
  expect("refused" in contractFromDesign(saved)).toBe(true);
});
