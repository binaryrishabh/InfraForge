import { expect, test } from "bun:test";
import { findChallenge } from "../challenges/registry";
import { LEARNING_REGISTRY } from "../learning/registry";
import { buildRunReport } from "../reports/report";
import { answers, attemptRow } from "./challengeHarness";
test("shed-load text uses measured final-second p95 of about 3 ms per active request", () => {
  for (const active of [8, 16, 32]) {
    const d = findChallenge("shed-load-at-the-edge", 1)!.definition, s = structuredClone(d.starter!);
    s.resources.find(r => r.id === "lb")!.lbAdmission!.maxActive = active;
    const r = buildRunReport(attemptRow(d, s, answers(d, {health: "critical"})));
    expect(r.terminal!.traffic!.latencyMs.p95!).toBeCloseTo(3 * active, 0);
  }
  expect(LEARNING_REGISTRY.findLesson("shed-load-at-the-edge")!.limitations.join(" ")).toContain("about 3 ms times the Active requests limit");
  expect(LEARNING_REGISTRY.findLesson("bound-replica-staleness")!.limitations.join(" ")).toContain("route a user's reads to the writer");
}, 120000);
