// Real scorer/engine with subprocess fixtures, not Docker containment or host qualification.
import { strict as assert } from "node:assert";
import { appendFile, lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { publicChallenge, admitScoredChallenge } from "../../apps/backend/firstStack/scoredChallenges/definition";
import { challengeFence, executeScoredChallenge } from "../../apps/backend/firstStack/scoredChallenges/execution";
import { canonical, designRevision } from "../../apps/backend/firstStack/canonical";
import { inputDigest } from "../../apps/backend/firstStack/isolationProtocol";
import { fixtureCut } from "../../apps/backend/tests/verifierProtocolFixture";

const [mode, directory, phase, socket] = process.argv.slice(2);
assert.ok(directory?.startsWith("/run/infraforge-verifier-proof-"));
const file = (name: string) => join(directory!, name);
const engine = { source: "a".repeat(64), image: `sha256:${"b".repeat(64)}` };
const deadline = setTimeout(() => process.exit(1), 120000);
if (mode === "child") {
  process.on("SIGTERM", () => {
    void appendFile(file("child-signalled"), phase! + "\n").finally(() => process.exit(99));
  });
  if (phase === "visible" || phase === "hidden-1") {
    const requested = await readFile(file("stop-phase"), "utf8");
    if (phase === requested) {
      await writeFile(file("active"), phase);
      while (!await Bun.file(file("continue")).exists()) await Bun.sleep(10);
      await Bun.sleep(100); // Give an incorrectly forwarded SIGTERM time to arrive.
    }
  }
  const input = await Bun.stdin.text();
  console.log(JSON.stringify(fixtureCut(input, engine.source)));
  clearTimeout(deadline);
} else {
  assert.equal(mode, "supervisor");
  assert.ok((await lstat(socket!)).isSocket(), "Exact rootless socket must be visible inside the sandbox");
  assert.equal((await fetch("http://localhost/_ping", { unix: socket! })).status, 200);
  const keepAlive = setInterval(() => {}, 1000);
  let job: Promise<void>, stopping = false, hidden = 0;
  process.on("SIGTERM", () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await writeFile(file("continue"), "drain");
      await job;
      clearInterval(keepAlive); clearTimeout(deadline);
    })().catch(() => process.exit(1));
  });
  const execute = async (input: string, stage: string) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", import.meta.path,
      "child", directory!, stage], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write(input); await child.stdin.end();
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    assert.equal(code, 0, error);
    return { status: "completed", durablePrefix: JSON.parse(output),
      receipt: { schema: "first-stack-isolation-receipt/1", cleanup: "removed", fixture: "subprocess software proof only" } } as any;
  };
  job = (async () => {
    const owner = "service-stop-fixture", sample = await publicChallenge(owner, "lose-an-app-server", "1");
    const admitted = await admitScoredChallenge(owner, sample.layout, { id: sample.id, version: sample.version },
      sample.workload, sample.policy);
    const input = canonical({ owner, layout: sample.layout, candidate: admitted.prepared.sidecar,
      recording: sample.workload, policy: sample.policy });
    const visible = await execute(input, "visible");
    const run = { purpose: "scored", ownerId: owner, engine, input, inputHash: inputDigest(input),
      lock: admitted.prepared.lock, browserCut: visible.durablePrefix,
      workload: { challenge: admitted.reference }, lineage: { designRevision: designRevision(sample.layout) } };
    const fence = challengeFence({ async check() {}, async commit() { throw Error("Unexpected visible commit"); } },
      engine.source);
    const authority = { token: "fixture", async assertHeld() {},
      async commit(cut: any) { await fence.commit({} as any, cut); } };
    const score = await executeScoredChallenge(run, visible, authority, new AbortController().signal,
      fence.select, async next => {
        const result = await execute(next, `hidden-${++hidden}`);
        await authority.commit(result.durablePrefix); return result;
      });
    assert.ok(score); assert.ok(hidden > 0);
    await writeFile(file("result.json"), JSON.stringify({ scored: true, hidden }));
  })();
  void job.catch(() => process.exit(1));
}
