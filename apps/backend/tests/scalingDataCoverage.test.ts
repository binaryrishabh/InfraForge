import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";
import { latestChallenge } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";

// Audit scope: each reading/concept lesson in Tracks 2 and 3, not every possible
// infrastructure topic. Detailed limits and dropped candidates are in lb12-coverage.md.
const coverage = [
  {track: "scaling", concept: "load-balancer-policies", labs: ["route-around-a-slow-vm", "balancer-shares-turns"]},
  {track: "scaling", concept: "percentiles-and-populations", labs: ["route-around-a-slow-vm"]},
  {track: "scaling", concept: "retries-add-work", labs: ["retrying-a-full-pool"]},
  {track: "data", concept: "cache-hits-and-misses", labs: ["reuse-before-expiry", "cache-or-database", "catalogue-link-flash"]},
  {track: "data", concept: "connection-pool-budgets", labs: ["budget-app-database-sessions"]},
  {track: "data", concept: "replica-reads-and-writer-work", labs: ["move-reads-off-the-writer", "replicas-do-not-take-writes"]},
];

test("scaling/data coverage accounts for every concept exactly once and links real canonical runnable labs", () => {
  const concepts = learningContent.lessons.filter(l => ["scaling", "data"].includes(l.trackId) && l.kind !== "executable-lab");
  expect(coverage.map(row => row.concept).sort()).toEqual(concepts.map(l => l.id).sort());
  expect(new Set(coverage.map(row => row.concept)).size).toBe(coverage.length);
  for (const row of coverage) {
    expect(concepts.find(l => l.id === row.concept)!.trackId).toBe(row.track);
    const labs = row.labs.map(id => learningContent.lessons.find(l => l.id === id)!);
    expect(labs.every(l => l?.kind === "executable-lab" && l.availability === "available")).toBe(true);
    expect(labs.some(l => l.prerequisites.includes(row.concept))).toBe(true);
    for (const lesson of labs) {
      const d = latestChallenge(lesson.experiment!.challengeId)!.definition;
      expect(d.engine).toBe("2"); expect(d.starter).toBeDefined(); expect(REFERENCE[d.id]).toBeDefined();
    }
  }
});
