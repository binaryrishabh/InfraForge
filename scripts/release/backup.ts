import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { CutoverError, type Database } from "../../apps/backend/cutover/database";
import { collectEvidence, compareRestored } from "../../apps/backend/cutover/evidence";

export async function archiveChecksum(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function proveRestore(source: Database, restored: Database, dump: () => Promise<void>, restore: () => Promise<void>, archive: string) {
  const before = await collectEvidence(source);
  if (!["Infrastructure", "Deployment", "Outbox"].every((name) => before.tables[name])) throw new CutoverError("Backup source must be an existing InfraForge database");
  if (before.sessions.some((session) => session.backendType === "client backend" || session.backendType == null)) throw new CutoverError("Freeze/fence source clients before backup comparison");
  const empty = await restored.query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`);
  if (empty.rows[0].count) throw new CutoverError("Restore destination must be a separate empty disposable database");
  await dump();
  const checksum = await archiveChecksum(archive);
  await restore();
  if (await archiveChecksum(archive) !== checksum) throw new CutoverError("Backup archive changed during restore");
  const sourceAfter = await collectEvidence(source);
  if (compareRestored(before, sourceAfter).result !== "PASS") throw new CutoverError("Source changed during backup; no restore proof established");
  const comparison = compareRestored(before, await collectEvidence(restored));
  if (comparison.result !== "PASS") throw new CutoverError(`Restored schema/history/counts/content do not match source: ${JSON.stringify(comparison.differences)}`);
  return { result: "PASS", archiveSHA256: checksum, comparison, evidence: before };
}
