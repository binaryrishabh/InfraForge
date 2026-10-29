import { test, expect } from "bun:test";
import { DEFAULT_RETRY_SETTINGS, type CircuitBreakerSettings, type RetrySettings } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { contractFromDesign } from '../src/model2/product/fromDesign';
import { withTimeline } from '../src/model2/product/timeline';
import { compileProduct } from '../src/model2/product/compiler';
import { createProductModel2 } from '../src/model2/product/run';
import { createHash } from 'node:crypto';
import { buildContractFromRunInputs, type CapturedModel2Input } from '../src/model2/product/runContract';
const d = {schema:'infraforge-saved-design/1',resources:[{id:'lb',type:'Load Balancer',x:0,y:0},{id:'app',type:'Virtual Machine',x:0,y:0}],connections:[{id:'e',sourceId:'lb',targetId:'app',sourceType:'Load Balancer',targetType:'Virtual Machine',port:80}],workload:{targetThroughput:60,throughputUnit:'per-minute',trafficShape:'steady',readWriteRatio:0.8,payloadSize:'light'}} as const;
function output(retry?: RetrySettings, circuitBreaker?: CircuitBreakerSettings, legacy = false) {
  const saved = structuredClone(d) as unknown as SavedProductDesign;
  if (retry) saved.resources[0]!.retry = retry;
  if (circuitBreaker) saved.resources[0]!.circuitBreaker = circuitBreaker;
  const a = contractFromDesign(saved, legacy ? { failureCause: false } : undefined); if ("refused" in a) throw Error(JSON.stringify(a));
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
  expect(output(undefined, { enabled: false })).toEqual(a);
  expect(output(undefined, { enabled: false, failureThreshold: 3, cooldownMs: 1000 })).toEqual(a);
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
  expect(a.evidence.product.semantic.numericOrigins).toEqual(a.compiled.semantic.numericOrigins);
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

const legacyPins = [
  { contract: "5ca15365430cdc93a71bee190922cd27f63dd6d625343e756d56971e3472da1f", compiled: "6f181bb920a650b9526a12258cbf28e2dc22c9bb1d4fcea6d895f40baf47d991", evidence: "3c0dee02d311c963e09b292b92a433cc299e2ffd0b64516e8d003e2be760f055", assumptions: "beb2230c2f20a0f61c505ed8d2ba51c058c3fb259c39cc27aa8996960489d327" },
  { contract: "20a6183d5587a85df2df9ca8869d4d19404289943838d7f2b8adfd22cc832711", compiled: "a15681299ad2106fe79718511e5eba330c1416c0eb7d5184b4488b657600b245", evidence: "077fe2728c1c3832c565d761252b76523b26feb4a08fe8541fe15130ca2e6a15", assumptions: "0b82127e6358e9dbdb8b1c8c313312e198d0c9dbc8b8b358935a09978b9ded63" },
];
test("recorded retry and breaker revisions without cause keep pre-edit LF-normalized bytes", () => {
  const outputs = [output(DEFAULT_RETRY_SETTINGS, undefined, true), output(undefined, { enabled: true, failureThreshold: 1, cooldownMs: 1000 }, true)];
  for (const [i, value] of outputs.entries()) {
    expect(Object.fromEntries(Object.entries(value).map(([key, v]) => [key, hash(v)]))).toEqual(legacyPins[i]);
    expect(value.contract).not.toHaveProperty("failureCauseProfile");
  }
});
test("canvas selects causes only for enabled retry or breaker intent", () => {
  for (const value of [output(DEFAULT_RETRY_SETTINGS), output(undefined, { enabled: true, failureThreshold: 1, cooldownMs: 1000 })]) {
    expect(value.contract.failureCauseProfile).toBe("failure-cause/1");
    expect(value.compiled.input.failureCauseProfile).toBe("failure-cause/1");
    expect(value.compiled.semantic.versions.contract).toBe("canvas-assumptions/2/failure-cause/1");
  }
});

// Captured before this fix; hashes computed from executable shipped main (2f10e1c), before edits.
const historicalInput: CapturedModel2Input = {
  "resources": [
    {
      "id": "lb",
      "type": "Load Balancer",
      "x": 0,
      "y": 0,
      "retry": {
        "enabled": true,
        "maxAttempts": 2,
        "backoffMs": 100,
        "jitterRatio": 0.2,
        "maxConcurrentRetries": 4,
        "retryOn": [
          "connectionFailure",
          "timeout",
          "backendFailure"
        ]
      }
    },
    {
      "id": "app",
      "type": "Virtual Machine",
      "x": 0,
      "y": 0
    }
  ],
  "connectionLines": [
    {
      "id": "edge",
      "sourceId": "lb",
      "targetId": "app",
      "sourceType": "Load Balancer",
      "targetType": "Virtual Machine",
      "port": 80
    }
  ],
  "workloadProfile": {
    "targetThroughput": 120,
    "throughputUnit": "per-minute",
    "trafficShape": "steady",
    "readWriteRatio": 0.8,
    "payloadSize": "light",
    "peakMultiplier": 3
  },
  "seed": "historical-profile-proof"
};
test("production historical input builder preserves shipped-main contract, compiled input and evidence bytes", () => {
  const built = buildContractFromRunInputs(historicalInput, 5);
  if ("refused" in built) throw Error(JSON.stringify(built));
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: historicalInput.resources, connections: historicalInput.connectionLines, workload: historicalInput.workloadProfile };
  const compiled = compileProduct(design, built.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const run = createProductModel2(compiled.value); run.advanceTo(5_000_000);
  expect({contract: hash(built.contract), compiled: hash(compiled.value), evidence: hash(run.evidence())}).toEqual({
    "contract": "1c54177277a854fe678918ea7435875c5098e8cfd31afa68c6b5c35d851fe50a",
    "compiled": "230ae02de45892fdbc98f5a6a5888aea71b64d1ed8e5fc0cc313f01f256216e5",
    "evidence": "5f8b9b40e89d0c9569f62f28c5259ade841e630127b4700d648108e4a54efdcd"
});
  expect(built.contract).not.toHaveProperty("failureCauseProfile");
  expect(buildContractFromRunInputs({...historicalInput, adapterProfiles: []}, 5)).toEqual(built);
});

test("recorded implicit profiles select exactly the captured semantics", () => {
  const built = buildContractFromRunInputs({...historicalInput, adapterProfiles: ["failure-cause/1"]}, 5);
  if ("refused" in built) throw Error(JSON.stringify(built));
  expect(built.contract.failureCauseProfile).toBe("failure-cause/1");
  // A recorded profile stays selected even when its original trigger is no longer present.
  const input = structuredClone(historicalInput); delete input.resources[0]!.retry;
  const selected = buildContractFromRunInputs({...input, adapterProfiles: ["failure-cause/1"]}, 5);
  if ("refused" in selected) throw Error(JSON.stringify(selected));
  expect(selected.contract.failureCauseProfile).toBe("failure-cause/1");
});

test("historical failing retry evidence stays byte-identical to executable shipped main; new captures emit causes", () => {
  for (const enabled of [false, true]) {
    const input = enabled ? {...historicalInput, adapterProfiles: ["failure-cause/1" as const]} : historicalInput;
    const built = buildContractFromRunInputs(input, 5); if ("refused" in built) throw Error(JSON.stringify(built));
    const contract = withTimeline(built.contract, [{id: "crash", kind: "crash", node: "app", atUs: 1, durationUs: 5_000_000, restartUs: 1_000_000}]);
    const design: SavedProductDesign = {schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile};
    const compiled = compileProduct(design, contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
    const run = createProductModel2(compiled.value); run.advanceTo(5_000_000);
    const evidence = run.evidence(), terminals = evidence.network.trace.events.filter(e => e.kind === "attempt-terminal");
    expect(terminals.length).toBeGreaterThan(0);
    expect(terminals.some(e => Object.hasOwn(e, "rootReason"))).toBe(enabled);
    if (!enabled) expect(hash(evidence)).toBe("cce17d67b257b82f0cd5d08e47f7cbd92471e18052811d584bb4ab0e2fd15992");
  }
});
