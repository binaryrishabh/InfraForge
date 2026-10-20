import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IsolationConnection } from "../../apps/backend/firstStack/isolationConnection";
import { probeFirstStackContainer } from "../../apps/backend/firstStack/isolationRunner";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { orphanProof } from "./orphan";

// One task-owned container at a time. This cannot establish the multi-service
// headroom/API/DB gates; missing measurements remain false/Unknown.
export async function serialProof(control: IsolationConnection, configuration: { image: string; source: string },
  report: any, output: string, fixture: () => Promise<{ image: string; source: string }>, save: () => Promise<void>) {
  const f = await firstStackCompileFixture(8);
  const input = JSON.stringify({ owner: "qualification", layout: f.layout, candidate: f.sidecar, recording: f.schedule, policy: f.policy });
  const actor = { assertHeld: async () => {}, commit: async (cut: unknown) => { await writeFile(join(output, "last-cut.json"), JSON.stringify(cut)); } };
  const record = async (key: string, passed: boolean, value: unknown) => { report.checks[key] = passed; report.observations[key] = value; await save(); };
  const execution = await probeFirstStackContainer(control, configuration, { mode: "execute", input }, actor);
  await record("packaging", execution.status === "completed" && execution.receipt.cleanup === "removed", execution);
  if (execution.durablePrefix) {
    const replay = await probeFirstStackContainer(control, configuration, { mode: "replay", input, expected: execution.durablePrefix }, {
      assertHeld: async () => {}, commit: async () => { throw Error("Replay cannot commit"); },
    });
    await record("replay", replay.replay?.kind === "MatchesRecordedPrefix", replay);
  }
  for (const kind of ["cancellation", "revocation"]) {
    let held = true, cut: any = null; const stop = new AbortController();
    const result = await probeFirstStackContainer(control, configuration, { mode: "execute", input }, {
      assertHeld: async () => { if (!held) throw Error("Authorization revoked"); },
      commit: async value => { cut = value; await writeFile(join(output, `${kind}-cut.json`), JSON.stringify(value)); if (kind === "cancellation") stop.abort(); else held = false; },
    }, stop.signal);
    await record(kind, result.status === "interrupted" && cut?.cut.sequence === 1 && result.receipt.cleanup === "removed",
      { result, persistedFingerprint: cut?.fingerprint ?? null, store: "Local fixture; no claim about DB fencing" });
  }
  const stress = await fixture();
  for (const kind of ["controls", "pids", "quota", "memory", "output", "cpu", "wall"]) {
    console.info(`First-stack serial probe: ${kind}`);
    const value = await probeFirstStackContainer(control, stress, { mode: "probe", input: JSON.stringify({ probe: kind }) }, { assertHeld: async () => {}, commit: async () => {} });
    let key = kind, passed = false;
    if (kind === "controls") { key = "fds"; passed = value.status === "completed" && value.probe?.fdDenied === true && value.probe.readonly === true && value.probe.files < 128; }
    if (kind === "pids") passed = value.status === "completed" && value.probe?.denied === true && value.probe.count > 0 && value.probe.count < 64;
    if (kind === "quota") { key = "cpuQuota"; passed = value.status === "completed" && value.probe?.after.nr_throttled > value.probe?.before.nr_throttled && value.probe.after.throttled_usec > value.probe.before.throttled_usec; }
    if (kind === "memory") passed = value.status === "interrupted" && value.receipt.exit?.oom === true;
    if (kind === "output") passed = value.status === "interrupted" && /budget/.test(value.interruption?.reason ?? "") && value.receipt.cleanup === "removed";
    if (kind === "cpu") { key = "cpuTime"; passed = value.status === "interrupted" && value.receipt.exit?.code === 137 && value.receipt.exit.oom === false && value.receipt.elapsedMs < 59000; }
    if (kind === "wall") passed = value.status === "interrupted" && value.receipt.elapsedMs >= 59000 && value.receipt.elapsedMs < 75000;
    await record(key, passed, value);
  }
  if (execution.durablePrefix) {
    console.info("First-stack serial probe: worker death and replacement exclusion");
    const orphan = await orphanProof(control, configuration, input, output);
    await record("workerDeath", orphan.passed, orphan);
    await record("exclusive", orphan.replacement.created === null && orphan.replacement.status === "interrupted", orphan);
  }
  report.observations.unmeasured = {
    concurrencyTwo: "Not run: owner requires one container at a time",
    apiResponsive: "Unknown: API/worker/DB/Redis topology was not started",
    databaseLoss: "Unknown: actual PostgreSQL session termination not exercised",
    headroom: "Unknown: only serial executor observations; no intended deployment capacity claim",
  };
}
