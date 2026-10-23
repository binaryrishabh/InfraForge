import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { canonical, hash } from "../firstStack/canonical";
import { challengeDefinitionSchema } from "../firstStack/scoredChallenges/schema";
import { createChallengeRegistry, publicChallenge } from "../firstStack/scoredChallenges/definition";
import { configuredScoringDirectory, readPrivateBundle, ScoringUnavailableError } from "../firstStack/scoredChallenges/privateStore";
import { fakeDefinitions, fixtureDirectory, fixtureChallenges, scenarioIds } from "./scoringFixtures";

test("every public challenge has commitments and retired practice, with no hidden or rubric fields anywhere", () => {
  const paths = readdirSync(resolve(import.meta.dir, "../firstStack/scoredChallenges")).filter(p => p.endsWith(".json"));
  expect(paths).toHaveLength(7);
  function inspect(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      expect(["hidden", "rubric", "threshold", "criteria"]).not.toContain(key);
      inspect(child);
    }
  }
  for (const path of paths) {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dir, "../firstStack/scoredChallenges", path), "utf8"));
    expect(challengeDefinitionSchema.safeParse(raw).success).toBe(true);
    expect(raw.scoring.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(raw.practice).toHaveLength(2);
    expect(raw.practice.every((p: { label: string }) => p.label.includes("Public practice") && p.label.includes("synthetic teaching fixture"))).toBe(true);
    expect(raw.brief.description).not.toMatch(/\d+%|p95 at most/);
    inspect(raw);
  }
});

test("fake bundle commitments survive JSON formatting and line endings, while returning fresh copies", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "infraforge-scoring-"));
  try {
    for (const id of scenarioIds) {
      const definition = fixtureChallenges.definition(id, "2");
      const raw = JSON.parse(readFileSync(resolve(fixtureDirectory, `${id}.v2.json`), "utf8"));
      writeFileSync(resolve(directory, `${id}.v2.json`), JSON.stringify(raw, null, 2).replace(/\n/g, "\r\n"));
      expect(readPrivateBundle(definition, directory)).toEqual(raw);
      const registry = createChallengeRegistry([definition], () => directory);
      const reference = { id, version: "2", definitionHash: hash(definition) };
      const first = registry.scoring(reference); first.hidden.length = 0;
      expect(registry.scoring(reference).hidden).toHaveLength(2);
    }
  } finally { rmSync(directory, { recursive: true }); }
});

test("missing, non-file, corrupt, mismatched and invalid private data fail closed without content or path diagnostics", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "infraforge-scoring-")), definition = structuredClone(fakeDefinitions[0]!);
  const path = resolve(directory, `${definition.id}.v2.json`);
  function refused() {
    try { readPrivateBundle(definition, directory); throw Error("Accepted private data"); }
    catch (error) {
      expect(error).toBeInstanceOf(ScoringUnavailableError);
      expect((error as ScoringUnavailableError).statusCode).toBe(503);
      expect((error as Error).message).toBe("Scoring unavailable");
      expect(String(error)).not.toContain(directory);
    }
  }
  try {
    refused();
    mkdirSync(path); refused(); rmdirSync(path);
    writeFileSync(path, "PRIVATE-BAD-JSON"); refused();
    const bundle = JSON.parse(readFileSync(resolve(fixtureDirectory, `${definition.id}.v2.json`), "utf8"));
    writeFileSync(path, canonical({ ...bundle, version: "stale" })); refused();
    for (const changed of [{ ...bundle, id: "wrong-id" }, { ...bundle, version: "stale" },
      { ...bundle, challengeVersion: "stale" }, { ...bundle, hidden: [] }, { ...bundle, secretExtra: "never-accepted" }]) {
      definition.scoring.sha256 = hash(changed);
      writeFileSync(path, canonical(changed)); refused();
    }
    writeFileSync(path, " ".repeat(1024 * 1024 + 1)); refused();
  } finally { rmSync(directory, { recursive: true }); }
});

test("visible samples remain usable with no private store and cannot reveal private content", async () => {
  const registry = createChallengeRegistry(fakeDefinitions, () => undefined);
  const sample = await publicChallenge("sample-only", scenarioIds[0]!, "2", registry);
  expect(sample.workload.rows.length).toBeGreaterThan(0);
  expect(JSON.stringify(sample)).not.toMatch(/"hidden"|"rubric"|"threshold"/);
  const definition = registry.definition(sample.id, sample.version);
  expect(() => registry.scoring({ id: sample.id, version: sample.version, definitionHash: hash(definition) })).toThrow("Scoring unavailable");
});

test("production configuration refuses repository paths, relative paths and unavailable directories", () => {
  for (const path of ["", "relative-store", fixtureDirectory, resolve(import.meta.dir, "../../.."), resolve(tmpdir(), "missing-scoring-directory")]) {
    expect(() => configuredScoringDirectory(path)).toThrow("Scoring unavailable");
  }
});
