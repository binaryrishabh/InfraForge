import { connectDatabase, CutoverError } from "../../apps/backend/cutover/database";
import { command, waitFor } from "./process";
import type { ComposeRelease } from "./compose";
import type { Release } from "./sequence";

export async function proveWorkerRecovery(operations: ComposeRelease, release: Release, databaseUrl: string, maximumMs = 10000) {
  if (!/^infraforge_(release|rehearsal)_[a-f0-9]{8}$/.test(operations.project) || maximumMs < 1000 || maximumMs > 15000) {
    throw new CutoverError("Worker interruption proof requires a unique owned rehearsal project and bounded recovery deadline");
  }
  const db = connectDatabase(databaseUrl, "infraforge-rehearsal-lock");
  await db.connect();
  const owners = async () => (await db.query(`SELECT pid FROM pg_locks WHERE locktype='advisory'
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND classid=186542854::oid AND objid=1::oid AND objsubid=2 AND granted`)).rows;
  try {
    const old = await owners();
    if (old.length !== 1) throw new CutoverError("Exactly one existing worker advisory lock is required");
    const id = await operations.compose(["ps", "-q", "worker"]);
    const [record] = JSON.parse(await command(["docker", "inspect", id], operations.root, operations.environment));
    if (record.Id !== id || record.Config.Labels?.["com.docker.compose.project"] !== operations.project ||
        record.Config.Labels?.["com.docker.compose.service"] !== "worker" || record.HostConfig.RestartPolicy.Name !== "no" ||
        record.Image !== release.imageId || !record.State.Running) throw new CutoverError("Worker interruption ownership/restart-policy check failed");
    const start = performance.now();
    await command(["docker", "kill", "--signal", "KILL", id], operations.root, operations.environment);
    await waitFor(async () => (await owners()).length === 0, maximumMs);
    const releasedMs = Math.round(performance.now() - start);
    if (releasedMs > maximumMs) throw new CutoverError("Worker session lock release exceeded the accepted deadline");
    await operations.compose(["up", "-d", "--no-build", "--pull", "never", "--force-recreate", "--scale", "worker=1", "worker"]);
    await waitFor(async () => { const rows = await owners(); return rows.length === 1 && rows[0].pid !== old[0].pid; }, maximumMs);
    const reacquiredMs = Math.round(performance.now() - start);
    if (reacquiredMs > maximumMs) throw new CutoverError("Replacement worker acquisition exceeded the accepted deadline");
    await operations.ready(release);
    return { result: "PASS", oldWorkerKilled: true, releasedMs, reacquiredMs, maximumMs, owners: (await owners()).length };
  } finally { await db.end(); }
}
