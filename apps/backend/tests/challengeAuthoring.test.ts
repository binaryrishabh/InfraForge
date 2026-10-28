import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { CHALLENGE_VERSIONS } from "../challenges/definitions";
import { challengeSeed, listLatestChallenges } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { REFERENCE, answers, attemptReport, tier } from "./challengeHarness";

/* The published list: every version learners may have attempted, with its spec hash.
A published version never changes and is never removed. To change a challenge, add
the next version file, register it in definitions/index.ts and pin it here. Run with
`bun run check:challenges`. */
export const PUBLISHED: Record<string, string> = {
  "after-the-cache-returns@1": "4511ec082bcd0127140ea1689ccdc0fb5179362f891645ccef6008dde0e645e6",
  "headroom-under-cpu-pressure@1": "ca4b7cc902a9515b7cdb5251cfc27cd964172a917a5b75ccd64cfa6f7c96b10a",
  "first-production-api@1": "515c84a6da8a78c5b4c30269e0c20dff5f934e8f98608fbac572f3782dd33888",
  "secure-the-edge@1": "4166582eef18e35bee1b554c764a1debbf6d324c28cc87f5d56c7f0e02b50849",
  "cache-matters@1": "848a196cdcfe6f368690575f46384a4123e7e96af9eedc6469f442db6707c4b1",
  "write-heavy@1": "728d1ad3cf9b44b324fad21dad4e480679c495d0c1968f89ee383eed9905c292",
  "scale-out-safely@1": "718049a66d5f3147f9319f765726c5aaf687e9c254058159bacb47e19f991c23",
  "peak-traffic@1": "07bbee27be116c2f4ec0cac8382bddd1ca51aca0dde44794135e05eb5d6c5388",
  "lose-an-app-server@1": "093a4a471456b4d89c8f7ce5b68acd973fca1515ffd4e7d1b420b0c9ea23f7ae",
  "cache-failure@1": "d93e6ecb2077757c8a3cf54cd15c702b7b93c7cad7e8a4c5166151e8e7e24100",
  "first-production-api@2": "33b959e6308b9b7abcbe59a2a944f0ca7afbd52519fd0144408a0e0011f04f71",
  "secure-the-edge@2": "998084b396de1fdc5bea0d90edc0594e0220a7a1e74e4b727de4ec706af92e49",
  "cache-matters@2": "37f7bf8b4e934f56b17877e0922d1247778a1a92c118d4cd674f46eda4ff04c8",
  "write-heavy@2": "f485a8fd571af01ef9b7633bc949b71dd403c0bdb300729fc86612d5b8c3a67b",
  "scale-out-safely@2": "c00547f724b901af3d36f88f6c3e0e1827900c31e5d9d15682b0f825fe7eda4d",
  "peak-traffic@2": "c9bf7894d00a86a0cf6a7ba29d2ce8c4469d187b10138035c72e3ed20850a088",
  "lose-an-app-server@2": "14220bd9ab19e9a1c37b68e1c040098b247bedf0be1cac6fab3b60d74172b9e9",
  "headroom-under-cpu-pressure@2": "f72994553399762ecd00739b55aedf34651618f23946f601e25f8ddfcfce9677",
};

const ANSWERS = { "overall-health": "healthy", "database-health": "healthy", "busiest-type": "Database", "security-clean": "yes",
  "scale-out": "no", "baseline-health": "healthy", "survivor-health": "degraded", "target-health": "healthy" };
const cache = CHALLENGE_VERSIONS.find((d) => d.id === "cache-failure")!;
const withEdit = (edit: (d: ChallengeDefinition) => ChallengeDefinition) => CHALLENGE_VERSIONS.map((d) => d === cache ? edit(structuredClone(d)) : d);

describe("challenge authoring", () => {
  test("every registered version is valid, contiguous and pinned to its published hash", () => {
    expect(validateChallengeVersions(CHALLENGE_VERSIONS, PUBLISHED)).toEqual([]);
    expect(Object.keys(PUBLISHED)).toHaveLength(CHALLENGE_VERSIONS.length);
    expect(new Set(CHALLENGE_VERSIONS.map((d) => challengeSeed(d))).size).toBe(CHALLENGE_VERSIONS.length);
  });

  test("a changed, removed, unpinned, duplicated or skipped version is rejected", () => {
    const edited = withEdit((d) => ({ ...d, hints: [...d.hints.slice(0, -1), "Rewritten hint."] }));
    expect(validateChallengeVersions(edited, PUBLISHED)).toContainEqual(expect.stringContaining("cache-failure@1: a published version changed; ship the change as version 2"));
    expect(validateChallengeVersions(CHALLENGE_VERSIONS.filter((d) => d !== cache), PUBLISHED)).toContainEqual("cache-failure@1: a published version was removed; old attempts need it");
    const next = { ...cache, version: 3 };
    expect(validateChallengeVersions([...CHALLENGE_VERSIONS, next], PUBLISHED)).toContainEqual("cache-failure@3: not pinned; add its spec hash to the published list");
    expect(validateChallengeVersions([...CHALLENGE_VERSIONS, { ...cache }], PUBLISHED)).toContainEqual("Duplicate challenge version cache-failure@1");
    expect(validateChallengeVersions([...CHALLENGE_VERSIONS, { ...cache, version: 4 }], PUBLISHED)).toContainEqual(expect.stringContaining("without gaps"));
  });

  test("malformed content, unsupported rules and impossible predictions are named", () => {
    const problems = (edit: (d: ChallengeDefinition) => ChallengeDefinition) => validateChallengeVersions(withEdit(edit), {}).filter((p) => p.startsWith("cache-failure@1:") && !p.includes("not pinned"));
    expect(problems((d) => ({ ...d, title: "x".repeat(61) }))).toContainEqual(expect.stringContaining("title"));
    expect(problems((d) => ({ ...d, predictions: [...d.predictions, { ...d.predictions[0]! }] }))).toContain("cache-failure@1: prediction ids must be unique");
    expect(problems((d) => ({ ...d, criteria: [...d.criteria, { id: "magic", kind: "uptime" as never, label: "Uptime" }] }))).toContain("cache-failure@1: criterion magic has unsupported kind uptime");
    expect(problems((d) => { delete d.experiment; return d; })).toEqual(expect.arrayContaining([
      "cache-failure@1: criterion survivors needs an experiment", "cache-failure@1: prediction baseline can only be judged with an experiment"]));
    expect(problems((d) => ({ ...d, evaluationSeconds: 0 }))).toContainEqual(expect.stringContaining("evaluationSeconds"));
    expect(problems((d) => ({ ...d, workload: { ...d.workload, readWriteRatio: 2 } }))).toContainEqual(expect.stringContaining("workload.readWriteRatio"));
  });

  test("a malformed starter or an impossible experiment is rejected before anyone can run it", () => {
    const problems = (edit: (d: ChallengeDefinition) => ChallengeDefinition) => validateChallengeVersions(withEdit(edit), {}).filter((p) => p.startsWith("cache-failure@1:") && !p.includes("not pinned"));
    expect(problems((d) => ({ ...d, starter: { ...d.starter!, connectionLines: [...d.starter!.connectionLines, { ...d.starter!.connectionLines[0]!, id: "ghost", targetId: "missing" }] } })))
      .toContain("cache-failure@1: starter connection ghost references a missing resource");
    expect(problems((d) => ({ ...d, starter: { ...d.starter!, connectionLines: [...d.starter!.connectionLines, { id: "db-dns", sourceId: "db", targetId: "dns", sourceType: T.Database, targetType: T.DNS, port: 53 }] } })))
      .toContain("cache-failure@1: starter connection db-dns breaks the connection rules");
    expect(problems((d) => ({ ...d, experiment: { ...d.experiment!, target: { resourceId: "redis", type: T.Cache } } })))
      .toContainEqual(expect.stringContaining("experiment target: The experiment targets redis"));
    expect(problems((d) => ({ ...d, experiment: { ...d.experiment!, target: { resourceId: "cache", type: T.Database } } })))
      .toContainEqual(expect.stringContaining("needs cache to stay a Database"));
    expect(problems((d) => ({ ...d, experiment: { ...d.experiment!, atSimulatedSecond: 30 }, evaluationSeconds: 60 })))
      .toContain("cache-failure@1: the fault must not start before the 60-second ramp ends");
    expect(problems((d) => ({ ...d, evaluationSeconds: 120 }))).toContain("cache-failure@1: evaluation must be at second 90, the fault's last active second");
    expect(problems((d) => ({ ...d, evaluationSeconds: 200 }))).toContain("cache-failure@1: evidence window exceeds 121 retained points");
    expect(problems((d) => ({ ...d, workload: { ...d.workload, throughputUnit: "per-second" as never } }))).toContainEqual(expect.stringContaining("workload.throughputUnit"));
  });

  test("the hidden reference designs never ship: no runtime module imports them and the image excludes tests", async () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (["node_modules", "tests", "lib", ".turbo"].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (path.endsWith(".ts") && /challengeHarness|\bREFERENCE\b/.test(await readFile(path, "utf8"))) offenders.push(path);
      }
    };
    await walk(root);
    expect(offenders).toEqual([]);
    const ignore = await readFile(join(root, "..", "..", ".dockerignore"), "utf8");
    expect(ignore).not.toMatch(/^!apps\/backend\/tests/m);
    for (const web of ["src", "public"]) {
      const files: string[] = [];
      const list = async (dir: string): Promise<void> => { for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) await list(p); else files.push(p); } };
      await list(join(root, "..", "web", web));
      for (const file of files) expect(await readFile(file, "utf8")).not.toContain("challengeHarness");
    }
  });
});

describe("calibration against the real engine", () => {
  for (const { definition: d } of listLatestChallenges()) {
    test(`${d.id}@${d.version}: a hidden reference meets every requirement and the starter does not`, () => {
      const passed = attemptReport(d, REFERENCE[d.id]!, answers(d, ANSWERS));
      expect(passed.challenge?.criteria.filter((r) => r.status !== "met")).toEqual([]);
      expect(passed.challenge?.status).toBe("met");
      expect(passed.terminal?.simulatedSeconds).toBe(d.evaluationSeconds);
      const failed = attemptReport(d, d.starter ?? tier(1), answers(d, ANSWERS));
      expect(failed.challenge?.status).toBe("not-met");
      expect(failed.challenge!.metCount).toBeLessThan(failed.challenge!.total);
      if (d.experiment) for (const report of [passed, failed]) {
        expect(report.challenge?.experiment).toMatchObject({ state: "ended", appliedSimulatedSeconds: d.experiment.atSimulatedSecond,
          endedSimulatedSeconds: d.evaluationSeconds - (d.experiment.postFaultObservationSeconds ?? 0), baselineOverallHealth: "healthy" });
      }
    }, 120000); // Model 2 versions run two full simulations
  }
});
