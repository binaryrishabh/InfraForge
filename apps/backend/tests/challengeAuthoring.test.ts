import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { CHALLENGE_VERSIONS } from "../challenges/definitions";
import { challengeSeed, listLatestChallenges } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { REFERENCE, answers, attemptReport, tier } from "./challengeHarness";
import { cacheReturnEvidence } from "./cacheReturnCalibration";

/* The published list: every version learners may have attempted, with its spec hash.
A published version never changes and is never removed. To change a challenge, add
the next version file, register it in definitions/index.ts and pin it here. Run with
`bun run check:challenges`. */
export const PUBLISHED: Record<string, string> = {
  "keep-a-function-warm@1": "efda13d2be6bb0bdbbddcafa04651a1da0bd71a8e0d8cd1f72cf991b987a6d17",
  "isolate-route-credits@1": "ff684b4d4f574fef8ef9c1e4c08ca028c292ab089fb947dcd39331b479e70da4",
  "resolve-after-publication@1": "20590c51974fbf82a58914cc82fae9d3e34a29bc92b2293f15461ee70524c681",
  "fit-the-working-set@1": "071827d3fb6839b4b40bb4919b6b6ce440f08832b7d496df47e02dd53b30eba9",
  "shed-load-at-the-edge@1": "0fd15203a45f7f89aa077433944da36464e0fff39785f6799243b0ea7cb0fb12",
  "hold-slots-on-a-slow-call@1": "036d8abb5a6686413bd159e24fef657814fa7ff98d7a3e43c0f614941e404112",
  "admit-a-replica-image@1": "ec9613f8a77d364e3a163a0cf230ed905d2e725a3c0db9bda1b5e635b9c8b96f",
  "restore-safe-redundancy@1": "631057be87e06eeea7a3a98f9d8afac0463dd5b8f9eb885c7a392e5b20290f19",
  "keep-failed-events@1": "4b85902f6b9e78e6b0c255c1de97f842c8d5b05e499e744fe7e755755f35877c",
  "redrive-after-the-fix@1": "8551be9f25d932fb776959b09fbba4ecf2ee7cae01bc775cc028061a97a605b8",
  "scale-on-delivered-samples@1": "cac34337c223d3317df087d258d96d8861e0446b866041290a026108de6dc539",
  "move-monitoring-samples@1": "51393acc5853e12455a28fef35ee2de6195836e77d7311e2d3765df614f3f82a",
  "object-bytes-versus-app-cpu@1": "094aeb495b39d709714a3af06177967813792079f4f06f1eb2df66f88d4ffde0",
  "size-the-app-database-pool@1": "ce8ab0399c1dcd29ca3997913d52ba30e4b311337e53a94cb809602090669194",
  "restore-a-database-writer@1": "e7c0c1a217ab01ecb79dd3a490d7f3d69f526788bb99d00286f8b7be884d0c25",
  "reuse-before-expiry@2": "da68b973d3fe19a49afd259da61031732ca766af391c25d48cda885477d6d757",
  "share-a-cache-fill@2": "6a7c4943ab093d98ca6b45c013446b9cf3a97b06617d6c3ef684d7db7b894b8a",
  "catalogue-link-flash@2": "f9a1a680729c8914d0220645176afdaa96b59203baa0e84e675358f96dacd8a9",
  "cache-or-database@2": "e58d912ba4273d541df9f4af2891aedba4607f8f66017e403f9d6d062ae570cc",
  "test-a-circuit-again@1": "a22e969c06464f71fb91d240cc03e3a8b3418743f5287ea507b5b578fcbd0ea6",
  "keep-an-asset-cached@1": "3f6328645b2f62cf07f9071f08e7a4b0d8956936a684ae55166f580fd6e7db71",
  "diagnose-consumer-credit@2": "df97ca199816deccd0b3cdcdd332775946ab04e1c36ab9380b9204bbb79a9e60",
  "split-the-capacity-budget@2": "b31028311687a8a42cba0be3bc68c3c30e575fa68def548daf8b7be55b97dbc1",
  "fit-a-request-in-memory@2": "7add8b437cf66bebd6ed45c0db752157eb8ff095b9f3817e88723e2a015c65d0",
  "open-and-size-an-api@1": "e63360ab61b729141f588a3a4f9c612a14c9e195f3024cdd9e08b7df5c829cce",
  "parallel-jobs-for-a-burst@1": "ebba322f2f43e7e6f3d90c5772ebf6c3ac227b25573911d352626471e2d7fe45",
  "check-the-missing-server@1": "8985ae0fdff18a9480d4f04c5141124da791b62bf81c647c6b91966ac936afe3",
  "keep-waiting-work@1": "e38032b569056c8d43e914fdb68aab62eb64a71869cfcb2b52c5b897fc85ed60",
  "share-a-cache-fill@1": "39cffc8c5eadbe309c710409abe4a0d4f3431b94c05ef9352f95596ef0ae6954",
  "reuse-before-expiry@1": "7eb2268b199d88bf9f961d0638bc98f28aecfac5ea08db66cff6855ba10362c0",
  "split-the-capacity-budget@1": "db47968e9080943fbcc8ac3c883fb4c0a4d486f143fc94b575ca7f57e8ca82a6",
  "diagnose-consumer-credit@1": "a236d0e516f6213362c7241dc1dcc309157870d403553239b71a01bdc6867f34",
  "fit-a-request-in-memory@1": "f9d6da9199e8abbc5045bcae85c2cec56d85f821ee86233d313a962be77e9763",
  "diagnose-query-admission@1": "af3d1ac31f9cca4078a377cc11d2c7c64a524c2bd3b16aada23829499a71aff5",
  "cache-or-database@1": "7e141efce731cbf7f0c531002f8b6b8c4e82af638a63ff05bd45bb667e14c0b0",
  "one-vm-or-a-pool@1": "c85cf9886ed04a2e284d20aa0de128b0ed311fd23ac0dbe668b448f7f55bec79",
  "limit-or-capacity@1": "48a7fce6157a217fd36abfc226be5a74d9aa453906fe2a23fb21175beed66423",
  "diagnose-lost-app-capacity@1": "c96034e934dbd75035b519f13035467cdae6eb9d8f08b921c06ad18cdb2466f2",
  "investigate-a-pool-reset@1": "ed61ae0627f3d15dcab41899f5cc80c5c54edf207c3068bdc9abe765e590500e",
  "budget-for-a-partition@1": "7b35c54cc84b3f4bc7af1e315fe55ed29b400b4395dca7fcce17a071b5e0d960",
  "trace-a-saturation-cascade@1": "b8b8a24164dfdc70aadc52aac2b4eb75c1bb8f3e6730d7206c400de777b29f64",
  "protect-one-api-route@1": "695b5f64876c96ff10cc0f6f37a9f74190b41a9378d92c0cc75a163ca7a509ea",
  "queue-overlapping-jobs@1": "ff340d09b24bff1c2f824e408ae3025f8bd39b7b6cec7cc9917fbcafaf6405cc",
  "bound-function-pool-pressure@1": "b58e0c704222b88d8e5d83d99dc998624c8b70f322e82d115ebd33767cd71d50",
  "writes-cost-more-than-reads@1": "d869e00ed5a9bfde21637c6ff046a60feb6a2a5a589a3e019110ae8c759a2836",
  "balancer-shares-turns@1": "2cd489a91c966d7138831326bec893927e16e0a13f6d9fd9bd9935a97dc9eddc",
  "catalogue-link-flash@1": "2d6afe745f45e31593096d34ae669138f45f2d6dadc2eff02295a71114ca7a6e",
  "flash-sale-order-backlog@1": "c84cc970bee937a37136dd716a85724ee589fd8706b82fbd709e64de825b4093",
  "notification-retry-storm@1": "e154e1b8a5741ba5754d9f1bb1bc95e6fb567530610563789f84aa709d2af3de",
  "analytics-burst-buffer@1": "b50e5b7b36b243530a74502c9bd4665ae9ebc74d1daeef70c2859456acfb91de",
  "find-the-denying-rule@1": "e002c76a7884c02b542cad296516b26d3c5eaceaa1f9991adaf490c8b690d7b3",
  "leave-room-for-firewall-flows@1": "492dca0578609884ed0729140e110de02cfd689831faecaa172f43eca803c705",
  "choose-a-retry-mitigation@1": "6ca83f5bd42df0ea1f6ad09bb15d139a7b3b15abb3083a93b0e4d7e8b65ef46e",
  "keep-up-with-the-queue@1": "80c57013d6a2e71fa6f89b77ba17a61ac682995aa376fada131d88cdcca96627",
  "leave-time-to-acknowledge@1": "545ede03623d81e9654e578a9ce2406689f162bce5543af7ddc84cd0701888e7",
  "open-one-subscriber@1": "bc2e0e6372b2bde7615fc4daa6b1f7a3c780bbf2b53a57c70d359945a69ba247",
  "move-reads-off-the-writer@1": "c2e20370cf5c8314c1906e2d80396a6b4cbb7f819be2368f8eb5472525412d1a",
  "budget-app-database-sessions@1": "8597b0eee650f2bd13dfe1da9ce88c3c1289b6048762925e167cd8ff5f9ac17a",
  "replicas-do-not-take-writes@1": "0727ed317ec1c9a39550330440641dc35cf9f8b9273a32d5cdf56f2cd8e1b213",
  "route-around-a-slow-vm@1": "96465260711b0f1ac74f1d62c606146c356721bde0b3843e0423d11b022a3f52",
  "leave-room-for-a-burst@1": "f7cbf5006543fbbe1739e32bc9f25d2a1761d7ef9227dbdf11afbe5a9e42f9e2",
  "retrying-a-full-pool@1": "5d8317a0a3d135a19466ec5e1da5b86e7d46bd6a4ffaebbaadaec4bf443ca49c",
  "where-does-the-time-go@1": "58174698cfd975ad0117a8cf029a13293c720115455140058090c0de9814b5e9",
  "waiting-with-spare-cpu@1": "e4fec65bcf80c96d30f239f2c7d6d4d8e3bc9427220c0bf5b40d6c47e8777f37",
  "one-bigger-or-two-smaller@1": "48b7361f4daf5649bf8ea465c307df7b5567bf32254743206e8a6cd80da13a56",
  "bound-retries-during-slowdown@1": "4325607f00dad696daf8bbf3da2c09891c137aaa9c984a8a3f6be9d8cf2cf4c2",
  "after-the-cache-returns@2": "3161f592b368a34b7b16d0c3804d08cae4ca44ecc9c70315ed83d70dd300bcce",
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
  "scale-out-safely@2": "ad955a3b59cd7ae2d3d2f8b786c7693686b18493ce0abc12804d5469084150ee",
  "peak-traffic@2": "c9bf7894d00a86a0cf6a7ba29d2ce8c4469d187b10138035c72e3ed20850a088",
  "lose-an-app-server@2": "14220bd9ab19e9a1c37b68e1c040098b247bedf0be1cac6fab3b60d74172b9e9",
  "headroom-under-cpu-pressure@2": "f72994553399762ecd00739b55aedf34651618f23946f601e25f8ddfcfce9677",
};

const ANSWERS = { "database-admission": "no-denials", "overall-health": "healthy", "database-health": "healthy", "busiest-type": "Database", "security-clean": "yes",
  "scale-out": "no", "baseline-health": "healthy", "survivor-health": "degraded", "target-health": "healthy" };
const cache = CHALLENGE_VERSIONS.find((d) => d.id === "cache-failure")!;
const withEdit = (edit: (d: ChallengeDefinition) => ChallengeDefinition) => CHALLENGE_VERSIONS.map((d) => d === cache ? edit(structuredClone(d)) : d);

describe("challenge authoring", () => {
  // Validate each complete family independently before checking the registry as
  // a whole. Every version is exercised, within the existing per-test budget.
  for (const challengeId of new Set(CHALLENGE_VERSIONS.map(d => d.id))) {
    test(`${challengeId}: every published definition is valid`, () => {
      const family = CHALLENGE_VERSIONS.filter(d => d.id === challengeId);
      const pins = Object.fromEntries(family.map(d => [`${d.id}@${d.version}`, PUBLISHED[`${d.id}@${d.version}`]!]));
      expect(validateChallengeVersions(family, pins)).toEqual([]);
    });
  }

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
    const sourceFiles: string[] = [];
    // Bound concurrent reads so the complete packaging audit fits its original
    // timeout on Windows too. Every discovered source still gets inspected.
    const inspectFiles = async (files: string[], inspect: (path: string) => Promise<void>) => {
      let next = 0;
      await Promise.all(Array.from({length: Math.min(8, files.length)}, async () => {
        while (next < files.length) await inspect(files[next++]!);
      }));
    };
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (["node_modules", "tests", "lib", ".turbo"].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (path.endsWith(".ts")) sourceFiles.push(path);
      }
    };
    await walk(root);
    await inspectFiles(sourceFiles, async path => {
      if (/challengeHarness|\bREFERENCE\b/.test(await readFile(path, "utf8"))) offenders.push(path);
    });
    expect(offenders).toEqual([]);
    const ignore = await readFile(join(root, "..", "..", ".dockerignore"), "utf8");
    expect(ignore).not.toMatch(/^!apps\/backend\/tests/m);
    for (const web of ["src", "public"]) {
      const files: string[] = [];
      const list = async (dir: string): Promise<void> => { for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) await list(p); else files.push(p); } };
      await list(join(root, "..", "web", web));
      await inspectFiles(files, async file => { expect(await readFile(file, "utf8")).not.toContain("challengeHarness"); });
    }
  });
});

describe("calibration against the real engine", () => {
  // Challenges whose latest version still needs Model 1 are retired and never run, so only Model 2 versions are calibrated.
  for (const { definition: d } of listLatestChallenges().filter(({ definition }) => definition.engine === "2")) {
    test(`${d.id}@${d.version}: a hidden reference meets every requirement and the starter does not`, () => {
      const passed = attemptReport(d, REFERENCE[d.id]!, answers(d, ANSWERS));
      expect(passed.challenge?.criteria.filter((r) => r.status !== "met")).toEqual([]);
      expect(passed.challenge?.status).toBe("met");
      expect(passed.terminal?.simulatedSeconds).toBe(d.evaluationSeconds);
      const failed = attemptReport(d, d.starter ?? tier(1), answers(d, ANSWERS));
      expect(failed.challenge?.status).toBe("not-met");
      expect(failed.challenge!.metCount).toBeLessThan(failed.challenge!.total);
      if (d.id === "after-the-cache-returns" && d.version === 2) {
        expect(validateChallengeVersions(CHALLENGE_VERSIONS, PUBLISHED)).toEqual([]);
        const at = (report: typeof failed, id: string) => report.terminal!.resources.find(r => r.id === id)!;
        expect(at(failed, "cache").health).toBe("healthy"); expect(at(failed, "db").health).toBe("saturated");
        expect(at(failed, "db").connections).toBe(85);
        expect(at(passed, "db").connections!).toBeLessThan(1360);
        expect(failed.experimentTrace?.moments?.firstTargetHealthy).toBe(d.experiment!.atSimulatedSecond + 32);
        expect(passed.experimentTrace?.moments?.firstOverallHealthy).toBe(d.experiment!.atSimulatedSecond + 32);
        expect(failed.challenge?.criteria.find(c => c.id === "connections")?.status).toBe("not-met");
        expect(REFERENCE[d.id]!.resources.filter(r => r.id !== "db")).toEqual(d.starter!.resources.filter(r => r.id !== "db"));
      }
      if (d.experiment) for (const report of [passed, failed]) {
        expect(report.challenge?.experiment).toMatchObject({ state: "ended", appliedSimulatedSeconds: d.experiment.atSimulatedSecond,
          endedSimulatedSeconds: d.evaluationSeconds - (d.experiment.postFaultObservationSeconds ?? 0), baselineOverallHealth: "healthy" });
      }
    }, d.id === "after-the-cache-returns" ? 600000 : 120000);
  }

  const d = listLatestChallenges().find(({ definition }) => definition.id === "after-the-cache-returns")!.definition;
  test("after-the-cache-returns@2: the identical burst with no fault scales out with healthy database headroom", () => {
    const control = cacheReturnEvidence(d, d.starter!, d.evaluationSeconds + 20, false);
    const initial = control.rows.find(row => row.second === 100)!;
    const burst = control.rows.filter(row => row.second >= 120);
    expect(burst.at(-1)!.second).toBe(d.evaluationSeconds + 20);
    expect(burst).toHaveLength(d.evaluationSeconds + 20 - 120 + 1);
    for (const row of burst) {
      expect(row.cacheHealth).toBe("healthy");
      expect(row.dbHealth).toBe("healthy");
      expect(row.health).toBe("healthy");
      expect(row.limit - row.sessions).toBeGreaterThan(0);
      expect(row.refusals).toBe(0);
    }
    expect(burst.some(row => row.replicas > initial.replicas)).toBe(true);
  }, 600000);

  test("after-the-cache-returns@2: real backlog, added pools before refusals, natural drain and byte-identical evidence", () => {
    const first = cacheReturnEvidence(d, d.starter!), second = cacheReturnEvidence(d, d.starter!);
    expect(second.evidenceHash).toBe(first.evidenceHash);
    expect(JSON.stringify(second.rows)).toBe(JSON.stringify(first.rows));
    const at = first.rows.find(row => row.second === d.evaluationSeconds)!;
    expect(at.active + at.queued + at.poolWaiters + at.orphans).toBeGreaterThan(0);
    expect(at.queued).toBeGreaterThan(0);
    const initial = first.rows.find(row => row.second === 100)!;
    const beforeRefusal = first.rows.find(row => row.replicas > initial.replicas && row.refusals === 0)!;
    expect(beforeRefusal).toBeDefined();
    expect(first.firstRefusalSecond!).toBeGreaterThan(beforeRefusal.second);
    expect(initial.replicas * first.connectionsPerPool).toBeLessThanOrEqual(initial.limit);
    expect(beforeRefusal.replicas * first.connectionsPerPool).toBeGreaterThan(initial.limit);
    expect(first.rows.every(row => row.limit === initial.limit)).toBe(true);
    expect(at.refusals).toBeGreaterThan(0);
    const scaling = first.controller.events.filter(event => event.kind === "evaluation").map(event => ({ at: event.at, ...JSON.parse(event.detail) as { utilization: number; recommendation: number } }));
    const crossing = scaling.find(event => event.recommendation > initial.replicas)!;
    expect(crossing.at).toBeGreaterThan(d.experiment!.atSimulatedSecond * 1_000_000);
    expect(crossing.utilization).toBeGreaterThan(d.starter!.resources.find(r => r.id === "app")!.autoscaling!.targetCpu! / 100 * 1.1); // includes the scaler's tolerance
    const drained = first.rows.at(-1)!;
    expect(drained.queued + drained.poolWaiters + drained.orphans).toBe(0);
    expect(drained.live).toBeLessThanOrEqual(initial.live);
    expect(at.cacheHealth).toBe("healthy");
    expect(at.dbHealth).not.toBe("healthy");
    const returned = first.rows.find(row => row.second > d.experiment!.atSimulatedSecond && row.cacheHealth === "healthy")!;
    const recovered = first.rows.find(row => row.second > at.second && row.dbHealth === "healthy" && row.health === "healthy")!;
    expect(returned.second).toBeLessThanOrEqual(at.second);
    expect(recovered).toBeDefined();
    expect(first.rows.filter(row => row.second >= returned.second && row.second <= at.second).every(row => row.dbHealth !== "healthy")).toBe(true);
    expect(drained.health).toBe("healthy");
    expect(drained.refusals).toBe(recovered.refusals);
  }, 600000);

  test("after-the-cache-returns@2: capping replicas avoids session exhaustion but cannot fix database CPU", () => {
    const capped = { ...d.starter!, resources: d.starter!.resources.map(r => r.id === "app" ? { ...r, autoscaling: { ...r.autoscaling!, maxReplicas: 8 } } : r) };
    const report = attemptReport(d, capped, answers(d, ANSWERS));
    expect(report.challenge?.criteria.find(c => c.id === "connections")?.status).toBe("met");
    expect(report.challenge?.criteria.find(c => c.id === "health")?.status).toBe("not-met");
    expect(report.terminal?.resources.find(r => r.id === "db")?.health).toBe("saturated");
    expect(report.terminal?.resources.find(r => r.id === "db")?.connections!).toBeLessThan(85);
  }, 300000);
});
