import { expect, test } from "bun:test";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { latestChallenge, specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";

const copy = (id = "cache-or-database") => structuredClone(latestChallenge(id)!.definition);
const check = (d: ChallengeDefinition) => validateChallengeVersions([d], {[`${d.id}@${d.version}`]: specHash(d)});

test("successful validation cannot hide in-place nested starter or criterion changes", () => {
  const d = copy(), original = structuredClone(d);
  expect(check(d)).toEqual([]);
  d.starter!.resources[0]!.skuId = "missing-instance";
  expect(check(d)).toContainEqual(expect.stringContaining("the starter must be runnable"));
  d.starter = structuredClone(original.starter);
  expect(check(d)).toEqual([]);
  const work = d.criteria.find(c => c.kind === "caller-outcomes")!;
  work.minCompleted = 0;
  expect(check(d)).toContainEqual(expect.stringContaining("caller-outcomes needs Model 2"));
  d.criteria = structuredClone(original.criteria);
  expect(check(d)).toEqual([]);
});

test("successful validation cannot hide an edited scenario target or restore boundary", () => {
  const d = copy("one-vm-or-a-pool"), original = structuredClone(d.scenario!);
  expect(check(d)).toEqual([]);
  d.scenario!.steps[0]!.request.target = {resourceId: "missing-app"};
  expect(check(d)).toContainEqual(expect.stringContaining("scenario:"));
  d.scenario = structuredClone(original);
  expect(check(d)).toEqual([]);
  d.scenario.steps[0]!.request.parameters.duration = d.evaluationSeconds;
  expect(check(d).length).toBeGreaterThan(0);
});

test("schema and published identity checks still run for previously valid objects", () => {
  const d = copy(), key = `${d.id}@${d.version}`, pin = specHash(d);
  const returned = check(d); expect(returned).toEqual([]);
  returned.push("caller-owned result mutation"); expect(check(d)).toEqual([]);
  expect(validateChallengeVersions([d], {[key]: "0".repeat(64)})).toContainEqual(expect.stringContaining("a published version changed"));
  expect(validateChallengeVersions([d], {})).toContain(`${key}: not pinned; add its spec hash to the published list`);
  expect(validateChallengeVersions([], {[key]: pin})).toContain(`${key}: a published version was removed; old attempts need it`);
  expect(validateChallengeVersions([d,d], {[key]: pin})).toContain(`Duplicate challenge version ${key}`);
  const hint = d.hints[0]!;
  d.hints[0] = "An edited hint.";
  expect(validateChallengeVersions([d], {[key]: pin})).toContainEqual(expect.stringContaining("a published version changed"));
  d.hints[0] = hint;
  (d as unknown as Record<string, unknown>).unexpected = undefined;
  expect(check(d)).toContainEqual(expect.stringContaining("unexpected"));
  delete (d as unknown as Record<string, unknown>).unexpected;
  expect(check(d)).toEqual([]);
});
