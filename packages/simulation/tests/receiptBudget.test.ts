import { expect, test } from "bun:test";
import { resolveWorkload } from "@infraforge/domain/workload";
import type { Resource } from "@infraforge/domain/resource";
import { createModel2Run } from "../src/model2/product/liveRun";
import { capReceipt, RECEIPT_BYTES } from "../src/model2/product/receiptBudget";
import { intervention } from "./interventionFixture";

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

test("an edge intervention onto a big autoscaled server keeps a receipt that fits the stored outcome", () => {
  const lb = "lb" + "a".repeat(60), app = "app" + "b".repeat(60), edge = "edge" + "c".repeat(60);
  const resources = [{ id: lb, type: "Load Balancer", x: 0, y: 0 }, { id: app, type: "Virtual Machine", x: 1, y: 0, autoscaling: { enabled: true, minReplicas: 1, maxReplicas: 60, targetCpu: 60 } }] as Resource[];
  const connectionLines = [{ id: edge, sourceId: lb, targetId: app, sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 }];
  const workloadProfile = resolveWorkload({ targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" });
  const run = createModel2Run({ resources, connectionLines, workloadProfile, seed: "receipt-budget" } as never, 60);
  run.advance();
  const result = run.apply(intervention("delay", { delay: 1000, duration: 2 }, { edgeId: edge, direction: "both" }));
  const receipt = (result as { outcome: { intervention: { resolvedTargets: string[]; affectedPaths: string[]; resolvedTargetCount?: number } } }).outcome.intervention;
  expect(bytes(receipt)).toBeLessThanOrEqual(RECEIPT_BYTES);
  expect(receipt.resolvedTargetCount).toBeGreaterThan(receipt.resolvedTargets.length);
  expect(receipt.resolvedTargets.length).toBeGreaterThan(0);
});

test("a receipt cut to fit keeps the first sorted IDs and the real counts; a small one is untouched", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `link-${String(i).padStart(5, "0")}-${"x".repeat(240)}`);
  const full = { interventionId: "delay", revision: 1, target: { edgeId: "e", direction: "both" as const }, parameters: {}, actionId: "a1", resolvedTargets: ids(2048), affectedPaths: ids(2048), atUs: 1, endUs: 2 };
  const cut = capReceipt(full);
  expect(bytes(cut)).toBeLessThanOrEqual(RECEIPT_BYTES);
  expect(cut).toMatchObject({ resolvedTargetCount: 2048, affectedPathCount: 2048 });
  expect(cut.resolvedTargets).toEqual(full.resolvedTargets.slice(0, cut.resolvedTargets.length));
  expect(capReceipt(cut)).toEqual(cut);
  const small = { ...full, resolvedTargets: ["a"], affectedPaths: [] };
  expect(capReceipt(small)).toBe(small);
});
