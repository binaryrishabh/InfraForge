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

// New introductions point forward to published labs without changing those labs' prerequisites.
const onramps = [
  {concept: "up-or-out", labs: ["one-bigger-or-two-smaller"]},
  {concept: "choose-the-constrained-tier", labs: ["balancer-shares-turns", "route-around-a-slow-vm", "leave-room-for-a-burst"]},
];
// These registered lessons explicitly have no editable/scored promotion experiment.
const conceptualOnly = ["promoting-a-replica", "promotion-and-pending-work"];
// Advanced synthesis looks back at labs; it adds no prerequisites to published lessons.
const reasoning = [
  {concept: "choose-data-constraints", labs: ["move-reads-off-the-writer", "budget-app-database-sessions", "replicas-do-not-take-writes"]},
  {concept: "initial-replicas-and-later-limits", labs: ["budget-app-database-sessions", "retrying-a-full-pool"]},
];

test("scaling/data coverage accounts for every concept exactly once and links real canonical runnable labs", () => {
  const concepts = learningContent.lessons.filter(l => ["scaling", "data"].includes(l.trackId) && l.kind !== "executable-lab");
  const accounted = [...coverage.map(row => row.concept), ...onramps.map(row => row.concept), ...conceptualOnly, ...reasoning.map(row => row.concept)];
  expect(accounted.toSorted()).toEqual(concepts.map(l => l.id).toSorted());
  expect(new Set(accounted).size).toBe(accounted.length);
  for (const row of reasoning) {
    const lesson = concepts.find(l => l.id === row.concept)!;
    expect(lesson.level).toBe("advanced"); expect(lesson.experiment).toBeNull();
    for (const id of row.labs) {
      expect(lesson.prerequisites).toContain(id);
      expect(lesson.explanation.join(" ")).toContain(`(${id})`);
      expect(learningContent.lessons.find(l => l.id === id)).toMatchObject({kind: "executable-lab", availability: "available"});
    }
  }
  for (const row of onramps) for (const id of row.labs) {
    expect(concepts.find(l => l.id === row.concept)!.followUp).toContain(`(${id})`);
    expect(learningContent.lessons.find(l => l.id === id)).toMatchObject({kind: "executable-lab", availability: "available"});
  }
  for (const id of conceptualOnly) {
    const lesson = concepts.find(l => l.id === id)!;
    expect(lesson).toMatchObject({trackId: "data", kind: "conceptual-exercise", experiment: null});
    expect(lesson.limitations.join(" ")).toMatch(/Conceptual only/);
    expect(lesson.limitations.join(" ")).toMatch(/no .*?(experiment|challenge|scored)/);
  }
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
